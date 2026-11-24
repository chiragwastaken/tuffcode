import {
  type AdapterDeps,
  type AdapterEvent,
  type AdapterSession,
  type ApprovalChoice,
  type ProviderConfig,
  type TurnContext,
} from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { OpenAIClient, readClientConfig, type ChatMessage, type FetchFn } from './client.js';
import { runTurn } from './loop.js';
import { createToolSessionState, type ToolSessionState } from './tools.js';

const LF = String.fromCharCode(10);

export interface OpenAIChatAdapterOverrides {
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

class OpenAIChatAdapter implements AdapterSession {
  readonly id: string;
  readonly providerId: string;
  readonly capabilities = { tools: true, approvals: true, resume: false, models: false };

  private readonly messages: ChatMessage[] = [];
  private readonly state: ToolSessionState = createToolSessionState();
  private readonly approvals = new Map<string, (choice: ApprovalChoice) => void>();
  private controller: AbortController | null = null;
  private disposed = false;

  constructor(
    provider: ProviderConfig,
    private readonly deps: AdapterDeps,
    private readonly client: OpenAIClient,
    private readonly maxIterations: number | undefined,
  ) {
    this.id = newId('sess');
    this.providerId = provider.id;
  }

  async *send(text: string, ctx: TurnContext): AsyncIterable<AdapterEvent> {
    if (this.disposed) throw new Error('openai adapter disposed');
    const controller = new AbortController();
    this.controller = controller;
    const onAbort = () => {
      controller.abort();
      this.denyApprovals();
    };
    if (ctx.signal.aborted) controller.abort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    const turnCtx: TurnContext = { ...ctx, signal: controller.signal };
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
        requestApproval: (approvalId) => this.requestApproval(approvalId),
        ...(this.maxIterations !== undefined ? { maxIterations: this.maxIterations } : {}),
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
    this.deps.logger.debug('openai adapter disposed', { providerId: this.providerId });
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

export async function createOpenAIChatAdapter(
  provider: ProviderConfig,
  deps: AdapterDeps,
  overrides: OpenAIChatAdapterOverrides = {},
): Promise<AdapterSession> {
  const config = readClientConfig(provider);
  const client = new OpenAIClient(config, {
    logger: deps.logger,
    ...(overrides.fetchFn !== undefined ? { fetchFn: overrides.fetchFn } : {}),
    ...(overrides.sleep !== undefined ? { sleep: overrides.sleep } : {}),
  });
  deps.logger.debug('openai adapter created', { providerId: provider.id });
  return new OpenAIChatAdapter(provider, deps, client, overrides.maxIterations);
}
