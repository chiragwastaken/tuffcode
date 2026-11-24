import {
  type AdapterDeps,
  type AdapterEvent,
  type AdapterSession,
  type ApprovalChoice,
  type ProviderConfig,
  type TurnContext,
} from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import {
  AnthropicClient,
  readAnthropicConfig,
  type AnthropicMessage,
  type FetchFn,
} from './client.js';
import { DEFAULT_MAX_TOOL_ITERATIONS, runTurn } from './loop.js';
import { createToolSessionState, type ToolSessionState } from '../openai/tools.js';

const LF = String.fromCharCode(10);

export interface AnthropicAdapterOverrides {
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  maxIterations?: number;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** The settings default is 40; a provider may narrow it, an override wins. */
function maxIterationsFor(provider: ProviderConfig, override: number | undefined): number {
  if (override !== undefined) return override;
  const raw = provider.config.maxToolIterations;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 100) return raw;
  return DEFAULT_MAX_TOOL_ITERATIONS;
}

function defaultModel(provider: ProviderConfig): string {
  const raw = provider.config.model;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '';
}

class AnthropicAdapter implements AdapterSession {
  readonly id: string;
  readonly providerId: string;
  readonly capabilities = { tools: true, approvals: true, resume: false, models: false };

  private readonly messages: AnthropicMessage[] = [];
  private readonly state: ToolSessionState = createToolSessionState();
  private readonly approvals = new Map<string, (choice: ApprovalChoice) => void>();
  private readonly model: string;
  private controller: AbortController | null = null;
  private disposed = false;

  constructor(
    provider: ProviderConfig,
    private readonly deps: AdapterDeps,
    private readonly client: AnthropicClient,
    private readonly maxTokens: number,
    private readonly maxIterations: number,
  ) {
    this.id = newId('sess');
    this.providerId = provider.id;
    this.model = defaultModel(provider);
  }

  async *send(text: string, ctx: TurnContext): AsyncIterable<AdapterEvent> {
    if (this.disposed) throw new Error('anthropic adapter disposed');
    const controller = new AbortController();
    this.controller = controller;
    const onAbort = () => {
      controller.abort();
      this.denyApprovals();
    };
    if (ctx.signal.aborted) controller.abort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    const model = ctx.model.trim().length > 0 ? ctx.model : this.model;
    const turnCtx: TurnContext = { ...ctx, model, signal: controller.signal };
    const turnId = ctx.turnId;
    this.messages.push({ role: 'user', content: userContent(text, ctx) });

    try {
      yield { type: 'turn.started', turnId };
      yield* runTurn({
        ctx: turnCtx,
        client: this.client,
        messages: this.messages,
        state: this.state,
        deps: this.deps,
        signal: controller.signal,
        maxTokens: this.maxTokens,
        requestApproval: (approvalId) => this.requestApproval(approvalId),
        maxIterations: this.maxIterations,
      });
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      if (this.controller === controller) this.controller = null;
      this.denyApprovals();
    }
  }

  approve(approvalId: string, decision: ApprovalChoice): void {
    const resolve = this.approvals.get(approvalId);
    if (!resolve) return;
    this.approvals.delete(approvalId);
    resolve(decision);
  }

  async interrupt(): Promise<void> {
    this.controller?.abort();
    this.denyApprovals();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.denyApprovals();
    this.controller = null;
    this.messages.length = 0;
    this.state.readSet.clear();
    this.deps.logger.debug('anthropic adapter disposed', { providerId: this.providerId });
  }

  private requestApproval(approvalId: string): Promise<ApprovalChoice> {
    const { promise, resolve } = deferred<ApprovalChoice>();
    if (this.disposed) {
      resolve('deny');
      return promise;
    }
    this.approvals.set(approvalId, resolve);
    return promise;
  }

  private denyApprovals(): void {
    for (const [approvalId, resolve] of this.approvals) {
      resolve('deny');
      this.approvals.delete(approvalId);
    }
  }
}

function userContent(text: string, ctx: TurnContext): string {
  if (ctx.attachments.length === 0) return text;
  const lines = ctx.attachments.map((attachment) => `- ${attachment.path} (${attachment.kind})`);
  return text + LF + LF + 'Attachments:' + LF + lines.join(LF);
}

export async function createAnthropicAdapter(
  provider: ProviderConfig,
  deps: AdapterDeps,
  overrides: AnthropicAdapterOverrides = {},
): Promise<AdapterSession> {
  const config = readAnthropicConfig(provider);
  const client = new AnthropicClient(config, {
    logger: deps.logger,
    ...(overrides.fetchFn !== undefined ? { fetchFn: overrides.fetchFn } : {}),
    ...(overrides.sleep !== undefined ? { sleep: overrides.sleep } : {}),
  });
  deps.logger.debug('anthropic adapter created', { providerId: provider.id });
  return new AnthropicAdapter(
    provider,
    deps,
    client,
    config.maxTokens,
    maxIterationsFor(provider, overrides.maxIterations),
  );
}
