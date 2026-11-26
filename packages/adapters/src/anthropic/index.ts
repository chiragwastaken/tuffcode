import {
  type AdapterDeps,
  type AdapterEvent,
  type AdapterSession,
  type ApprovalChoice,
  type ProviderConfig,
  type TurnContext,
} from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { planAttachments } from '../attachments.js';
import {
  AnthropicClient,
  readAnthropicConfig,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type FetchFn,
} from './client.js';
import { compactHistory, runTurn } from './loop.js';
import { createToolSessionState, type ToolSessionState } from '../openai/tools.js';

const LF = String.fromCharCode(10);

export interface AnthropicAdapterOverrides {
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
  private model: string;
  private controller: AbortController | null = null;
  private compaction: AbortController | null = null;
  private disposed = false;

  constructor(
    provider: ProviderConfig,
    private readonly deps: AdapterDeps,
    private readonly client: AnthropicClient,
    private readonly maxTokens: number,
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
    this.model = model;
    const turnCtx: TurnContext = { ...ctx, model, signal: controller.signal };
    const turnId = ctx.turnId;
    this.messages.push({ role: 'user', content: await userContent(text, ctx) });

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

  async compact(): Promise<{ removed: number }> {
    if (this.disposed) return { removed: 0 };
    const controller = new AbortController();
    this.compaction = controller;
    try {
      return await compactHistory({
        client: this.client,
        messages: this.messages,
        model: this.model,
        maxTokens: this.maxTokens,
        deps: this.deps,
        signal: controller.signal,
      });
    } finally {
      if (this.compaction === controller) this.compaction = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.compaction?.abort();
    this.denyApprovals();
    this.controller = null;
    this.compaction = null;
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

/**
 * The user message for one turn. Text-only turns keep a plain string; inlined images
 * turn the message into content blocks, the shape the Messages API expects.
 */
async function userContent(
  text: string,
  ctx: TurnContext,
): Promise<string | AnthropicContentBlock[]> {
  if (ctx.attachments.length === 0) return text;
  const plan = await planAttachments(ctx.attachments, ctx.vision);
  const notes = plan.notes.length === 0 ? '' : LF + LF + 'Attachments:' + LF + plan.notes.join(LF);
  if (plan.images.length === 0) return text + notes;
  const blocks: AnthropicContentBlock[] = [{ type: 'text', text: text + notes }];
  for (const image of plan.images) {
    blocks.push({ type: 'text', text: `Image file: ${image.name}` });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.data },
    });
  }
  return blocks;
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
  return new AnthropicAdapter(provider, deps, client, config.maxTokens);
}
