import { randomBytes } from 'node:crypto';
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ClientApp,
  type ClientConnection,
  type InitializeResponse,
  type NewSessionRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
  type StopReason,
} from '@agentclientprotocol/sdk';
import type {
  AdapterCapabilities,
  AdapterEvent,
  AdapterLogger,
  AdapterSession,
  ApprovalChoice,
  TurnContext,
} from '@tuffcode/contracts';
import {
  buildPromptBlocks,
  choosePermissionOption,
  decidePermission,
  emptyTranslationState,
  mapStopReason,
  translatePermissionRequest,
  translateSessionUpdate,
  type TranslationState,
} from './translate.js';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;

type TurnItem =
  | { readonly kind: 'update'; readonly update: SessionUpdate }
  | { readonly kind: 'approval'; readonly event: AdapterEvent }
  | { readonly kind: 'stop'; readonly stopReason: StopReason }
  | { readonly kind: 'failure'; readonly error: unknown }
  | { readonly kind: 'closed' };

class TurnQueue {
  private readonly items: TurnItem[] = [];
  private readonly waiters: ((item: TurnItem | null) => void)[] = [];
  private closed = false;

  push(item: TurnItem): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  next(): Promise<TurnItem | null> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }
}

interface ActiveTurn {
  readonly turnId: string;
  readonly ctx: TurnContext;
  readonly queue: TurnQueue;
  readonly approvals: Map<string, (choice: ApprovalChoice) => void>;
  interrupted: boolean;
}

export interface AcpSessionOptions {
  readonly providerId: string;
  readonly logger: AdapterLogger;
  /**
   * Connects a configured ACP client app to the agent. Production passes a
   * stdio stream; tests pass an in-process agent app.
   */
  readonly connect: (app: ClientApp) => ClientConnection;
  readonly terminate: () => Promise<void>;
  readonly handshakeTimeoutMs?: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' && error !== '' ? error : 'ACP request failed';
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`ACP handshake timed out after ${ms}ms`));
    }, ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class AcpSession implements AdapterSession {
  readonly providerId: string;
  private readonly logger: AdapterLogger;
  private readonly options: AcpSessionOptions;
  private readonly capabilitiesValue: AdapterCapabilities = {
    tools: true,
    approvals: true,
    resume: false,
    models: false,
  };
  private readonly localId = `acp_${randomBytes(8).toString('hex')}`;
  private connection: ClientConnection | null = null;
  private sessionId: string | null = null;
  private sessionCwd: string | null = null;
  private announcedSessionId: string | null = null;
  private agentCapabilities: AgentCapabilities | undefined;
  private active: ActiveTurn | null = null;
  private translation: TranslationState = emptyTranslationState;
  private disposed = false;

  constructor(options: AcpSessionOptions) {
    this.options = options;
    this.providerId = options.providerId;
    this.logger = options.logger;
  }

  get id(): string {
    return this.sessionId ?? this.localId;
  }

  get capabilities(): AdapterCapabilities {
    return this.capabilitiesValue;
  }

  attach(connection: ClientConnection): void {
    this.connection = connection;
    void connection.closed.then(() => {
      const turn = this.active;
      if (turn) {
        turn.queue.push({ kind: 'closed' });
      }
    });
  }

  onInitialize(response: InitializeResponse): void {
    this.agentCapabilities = response.agentCapabilities;
    this.capabilitiesValue.resume = response.agentCapabilities?.loadSession === true;
    this.logger.info('acp agent initialized', {
      providerId: this.providerId,
      agent: response.agentInfo?.name ?? 'unknown',
      protocolVersion: response.protocolVersion,
    });
  }

  onUpdate(sessionId: string, update: SessionUpdate): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    this.active?.queue.push({ kind: 'update', update });
  }

  async onPermissionRequest(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const turn = this.active;
    if (!turn || request.sessionId !== this.sessionId) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const verdict = decidePermission(turn.ctx.permissionMode, request.toolCall.kind);
    if (verdict !== 'ask') {
      const option = choosePermissionOption(
        request.options,
        verdict === 'allow' ? 'allow' : 'deny',
      );
      return option
        ? { outcome: { outcome: 'selected', optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' } };
    }

    const approvalId = `appr_${randomBytes(8).toString('hex')}`;
    const event = translatePermissionRequest(request, turn.turnId, approvalId);
    const decision = new Promise<ApprovalChoice>((resolve) => {
      turn.approvals.set(approvalId, resolve);
    });
    turn.queue.push({ kind: 'approval', event });
    const choice = await decision;
    const option = choosePermissionOption(request.options, choice);
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }

  approve(approvalId: string, decision: ApprovalChoice): void {
    const turn = this.active;
    const resolve = turn?.approvals.get(approvalId);
    if (!turn || !resolve) {
      return;
    }
    turn.approvals.delete(approvalId);
    resolve(decision);
  }

  async interrupt(): Promise<void> {
    const turn = this.active;
    if (!turn) {
      return;
    }
    await this.cancelTurn(turn);
  }

  private async cancelTurn(turn: ActiveTurn): Promise<void> {
    turn.interrupted = true;
    for (const resolve of turn.approvals.values()) {
      resolve('deny');
    }
    turn.approvals.clear();

    const connection = this.connection;
    const sessionId = this.sessionId;
    if (!connection || !sessionId) {
      turn.queue.push({ kind: 'closed' });
      return;
    }
    try {
      await connection.agent.notify(methods.agent.session.cancel, { sessionId });
    } catch {
      this.logger.warn('acp cancel failed, terminating agent', { providerId: this.providerId });
      connection.close();
      await this.options.terminate();
      turn.queue.push({ kind: 'closed' });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const turn = this.active;
    this.active = null;
    if (turn) {
      for (const resolve of turn.approvals.values()) {
        resolve('deny');
      }
      turn.approvals.clear();
      turn.queue.close();
    }
    const connection = this.connection;
    this.connection = null;
    try {
      connection?.close();
    } catch {
      // The connection may already be closed.
    }
    await this.options.terminate();
  }

  private async ensureSession(ctx: TurnContext): Promise<string> {
    if (this.sessionId !== null && this.sessionCwd === ctx.cwd) {
      return this.sessionId;
    }
    const connection = this.connection;
    if (!connection) {
      throw new Error('ACP connection is not open');
    }
    const request: NewSessionRequest = { cwd: ctx.cwd, mcpServers: [] };
    if (ctx.systemPrompt !== '' && this.agentCapabilities?.sessionCapabilities?.systemPrompt) {
      request.systemPrompt = {
        mode: 'append',
        content: [{ type: 'text', text: ctx.systemPrompt }],
      };
    }
    const response = await connection.agent.request(methods.agent.session.new, request);
    this.sessionId = response.sessionId;
    this.sessionCwd = ctx.cwd;
    this.translation = emptyTranslationState;
    this.logger.info('acp session created', { providerId: this.providerId });
    return response.sessionId;
  }

  async *send(text: string, ctx: TurnContext): AsyncIterable<AdapterEvent> {
    if (this.disposed) {
      throw new Error('ACP session is disposed');
    }
    if (this.active) {
      throw new Error('a turn is already running');
    }
    const sessionId = await this.ensureSession(ctx);
    const turn: ActiveTurn = {
      turnId: ctx.turnId,
      ctx,
      queue: new TurnQueue(),
      approvals: new Map(),
      interrupted: false,
    };
    this.active = turn;
    const onAbort = () => {
      void this.interrupt();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    let settled = false;
    try {
      if (this.announcedSessionId !== sessionId) {
        this.announcedSessionId = sessionId;
        yield {
          type: 'session.started',
          sessionId,
          model: ctx.model,
          capabilities: {
            tools: this.capabilitiesValue.tools,
            approvals: this.capabilitiesValue.approvals,
            resume: this.capabilitiesValue.resume,
          },
        };
      }
      yield { type: 'turn.started', turnId: ctx.turnId };

      if (ctx.signal.aborted) {
        settled = true;
        yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'interrupted' };
        return;
      }

      const connection = this.connection;
      if (!connection) {
        settled = true;
        yield { type: 'error', message: 'ACP connection is not open', retryable: false };
        yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'error' };
        return;
      }

      let prompt: Promise<PromptResponse>;
      try {
        prompt = connection.agent.request(methods.agent.session.prompt, {
          sessionId,
          prompt: buildPromptBlocks(text, ctx.attachments, {
            imageCapable:
              ctx.vision && this.agentCapabilities?.promptCapabilities?.image === true,
          }),
        });
      } catch (error) {
        settled = true;
        yield { type: 'error', message: errorMessage(error), retryable: false };
        yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'error' };
        return;
      }
      prompt.then(
        (response) => {
          turn.queue.push({ kind: 'stop', stopReason: response.stopReason });
        },
        (error: unknown) => {
          turn.queue.push({ kind: 'failure', error });
        },
      );

      for (;;) {
        const item = await turn.queue.next();
        if (item === null) {
          settled = true;
          yield { type: 'error', message: 'ACP agent connection closed', retryable: false };
          yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'interrupted' };
          return;
        }
        switch (item.kind) {
          case 'update': {
            const result = translateSessionUpdate(item.update, turn.turnId, this.translation);
            this.translation = result.state;
            for (const event of result.events) {
              yield event;
            }
            break;
          }
          case 'approval': {
            yield item.event;
            break;
          }
          case 'stop': {
            settled = true;
            yield {
              type: 'turn.finished',
              turnId: ctx.turnId,
              reason: mapStopReason(item.stopReason, turn.interrupted),
            };
            return;
          }
          case 'failure': {
            settled = true;
            if (turn.interrupted) {
              yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'interrupted' };
              return;
            }
            yield { type: 'error', message: errorMessage(item.error), retryable: false };
            yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'error' };
            return;
          }
          case 'closed': {
            settled = true;
            yield { type: 'error', message: 'ACP agent connection closed', retryable: false };
            yield { type: 'turn.finished', turnId: ctx.turnId, reason: 'interrupted' };
            return;
          }
        }
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      for (const resolve of turn.approvals.values()) {
        resolve('deny');
      }
      turn.approvals.clear();
      const abandoned = !settled && this.active === turn;
      if (this.active === turn) {
        this.active = null;
      }
      turn.queue.close();
      if (abandoned) {
        void this.cancelTurn(turn);
      }
    }
  }
}

/**
 * Opens an ACP client connection, completes `initialize`, and returns an
 * `AdapterSession`. The ACP session itself is created lazily on the first
 * `send`, because the contract supplies `cwd` per turn.
 */
export async function openAcpSession(options: AcpSessionOptions): Promise<AdapterSession> {
  const state = new AcpSession(options);
  const app = client({ name: 'Tuffcode' });
  app.onNotification(methods.client.session.update, ({ params }) => {
    state.onUpdate(params.sessionId, params.update);
  });
  app.onRequest(methods.client.session.requestPermission, ({ params }) =>
    state.onPermissionRequest(params),
  );

  const connection = options.connect(app);
  state.attach(connection);
  try {
    const response = await withTimeout(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'Tuffcode', title: 'Tuffcode', version: '0.0.0' },
      }),
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
      () => connection.close(),
    );
    state.onInitialize(response);
  } catch (error) {
    connection.close();
    try {
      await options.terminate();
    } catch {
      // The handshake error is the useful failure; keep it as the thrown cause.
    }
    throw error;
  }
  return state;
}
