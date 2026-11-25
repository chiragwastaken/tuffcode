import {
  AdapterUnavailableError,
  type AdapterEvent,
  type AdapterSession,
  type ApprovalChoice,
  type Attachment,
  type Settings,
  type Thread,
  type ThreadStatus,
  type TurnContext,
} from '@tuffcode/contracts';
import { newId, resolveWithin, type Logger } from '@tuffcode/shared';
import { captureStandingRules } from '../brain/rules.js';
import { threadLimits, type ModelLimits } from '../context/limits.js';
import { measureContext } from '../context/service.js';
import type { ContextSectionInput } from '../context/usage.js';
import type { ProviderRecord, Repos, TurnStatus } from '../db/repos/index.js';
import { badRequest, conflict, notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
import { planPrompt } from '../prompt/service.js';
import type { Secrets } from '../secrets/bridge.js';

export interface RunnerDeps {
  repos: Repos;
  bus: EventBus;
  logger: Logger;
  createAdapter: (provider: ProviderRecord, secret: string | null) => Promise<AdapterSession>;
  secrets: Secrets;
  settings: () => Settings;
}

export interface ActiveRunInfo {
  threadId: string;
  turnId: string;
  adapterKey: string;
}

export interface Runner {
  send(threadId: string, text: string, attachments?: Attachment[]): Promise<{ turnId: string }>;
  interrupt(threadId: string): Promise<void>;
  approve(threadId: string, approvalId: string, decision: ApprovalChoice): Promise<void>;
  disposeThread(threadId: string): Promise<void>;
  disposeAll(): Promise<void>;
  recoverOrphanedRuns(): void;
  listActive(): ActiveRunInfo[];
}

interface CachedSession {
  session: AdapterSession;
  adapterKey: string;
}

interface ActiveRun {
  session: AdapterSession;
  turnId: string;
  controller: AbortController;
  adapterKey: string;
}

interface TurnText {
  text: string;
  persisted: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function turnStatusFor(reason: 'complete' | 'interrupted' | 'error'): TurnStatus {
  if (reason === 'complete') return 'complete';
  if (reason === 'interrupted') return 'interrupted';
  return 'failed';
}

/** Appended to whatever streamed when the user interrupts, so the row is not read as final. */
export const INTERRUPTED_MARKER = '\n\n[interrupted]';

/** Message ids derive from the turn, so replaying a turn insert can never duplicate a row. */
function userMessageId(turnId: string): string {
  return `msg_${turnId}_user`;
}

function assistantMessageId(turnId: string): string {
  return `msg_${turnId}_assistant`;
}

export interface TurnStartInput {
  threadId: string;
  turnId: string;
  text: string;
  injectedIds: string[];
  createdAt: string;
}

/**
 * Creates the turn row and its user message in one transaction. A replay of the same
 * turn start (a retried request, a re-run) leaves the message untouched instead of
 * inserting a second copy.
 */
export function recordTurnStart(repos: Repos, input: TurnStartInput): void {
  repos.transaction(() => {
    if (repos.turns.get(input.turnId) === undefined) {
      repos.turns.create({
        id: input.turnId,
        threadId: input.threadId,
        status: 'running',
        injectedIds: input.injectedIds,
        createdAt: input.createdAt,
      });
    }
    repos.messages.addIfAbsent({
      id: userMessageId(input.turnId),
      threadId: input.threadId,
      role: 'user',
      content: input.text,
      createdAt: input.createdAt,
    });
  });
}

function resolveAttachments(
  worktreePath: string,
  attachments: readonly Attachment[],
): TurnContext['attachments'] {
  return attachments.map((attachment) => {
    let resolved: string;
    try {
      resolved = resolveWithin(worktreePath, attachment.path);
    } catch {
      throw badRequest(`attachment escapes the worktree: ${attachment.name}`);
    }
    return {
      path: resolved,
      kind: attachment.mimeType?.startsWith('image/') === true ? 'image' : 'file',
    };
  });
}

/**
 * The turn runner: one adapter session per thread, one active turn at a time.
 *
 * Every adapter event is appended to the event table before it is broadcast, so a
 * reconnect or a restart replays exactly what the renderer saw. `send` returns as
 * soon as the turn row exists; the run itself is an async generator consumed in the
 * background, and a generator failure becomes events instead of a rejected RPC.
 */
export function createRunner(deps: RunnerDeps): Runner {
  const { repos, bus, logger } = deps;
  const sessions = new Map<string, CachedSession>();
  const active = new Map<string, ActiveRun>();
  /** Streamed assistant text per in-flight turn, plus whether it was already stored. */
  const turnText = new Map<string, TurnText>();

  function emitThread(thread: Thread): void {
    bus.emit({ kind: 'event', type: 'thread.updated', threadId: thread.id, payload: thread });
  }

  /**
   * Recomputes usage from the turn's assembled sections plus the conversation and
   * broadcasts it. Compaction never touches persisted rows, so this is the only signal
   * that the in-memory history shrank.
   */
  function emitContext(
    thread: Thread,
    sections: readonly ContextSectionInput[],
    options: { excludeMessageId?: string; compacted: boolean; limits: ModelLimits },
  ): void {
    const usage = measureContext(repos, thread, sections, {
      ...(options.excludeMessageId === undefined
        ? {}
        : { excludeMessageId: options.excludeMessageId }),
      limits: options.limits,
    });
    bus.emit({
      kind: 'event',
      type: 'context.updated',
      threadId: thread.id,
      payload: {
        threadId: thread.id,
        usedTokens: usage.usedTokens,
        maxTokens: usage.maxTokens,
        percent: usage.percent,
        limitSource: usage.limitSource,
        compacted: options.compacted,
      },
    });
  }

  function setThreadStatus(thread: Thread, status: ThreadStatus): Thread {
    const updated = repos.threads.update(thread.id, { status, updatedAt: nowIso() });
    const next = updated ?? { ...thread, status };
    emitThread(next);
    return next;
  }

  function appendEvent(threadId: string, event: AdapterEvent): number {
    const seq = repos.events.append(threadId, event.type, event);
    bus.emit({
      kind: 'event',
      type: 'thread.event',
      threadId,
      seq,
      payload: event,
    });
    return seq;
  }

  function denyPending(threadId: string): void {
    const at = nowIso();
    for (const approval of repos.approvals.listPending(threadId)) {
      repos.approvals.resolve(approval.id, 'deny', at);
    }
  }

  /** Stores the streamed assistant text once per turn; interrupted text keeps a marker. */
  function persistAssistant(
    threadId: string,
    turnId: string,
    reason: 'complete' | 'interrupted' | 'error',
  ): void {
    const state = turnText.get(turnId);
    if (state === undefined || state.persisted || state.text.length === 0) return;
    state.persisted = true;
    repos.messages.addIfAbsent({
      id: assistantMessageId(turnId),
      threadId,
      role: 'assistant',
      content: reason === 'interrupted' ? `${state.text}${INTERRUPTED_MARKER}` : state.text,
      createdAt: nowIso(),
    });
  }

  function finishTurn(
    thread: Thread,
    turnId: string,
    reason: 'complete' | 'interrupted' | 'error',
  ): void {
    const at = nowIso();
    // An interrupt that landed first wins: a late adapter error must not flip the
    // turn (or its marker) back to a failed run.
    const current = repos.turns.get(turnId);
    const effective = current?.status === 'interrupted' ? 'interrupted' : reason;
    repos.turns.finish(turnId, turnStatusFor(effective), at);
    persistAssistant(thread.id, turnId, effective);
    denyPending(thread.id);
    setThreadStatus(thread, effective === 'error' ? 'failed' : 'ready-to-review');
  }

  function requestApproval(
    thread: Thread,
    turnId: string,
    event: Extract<AdapterEvent, { type: 'approval.requested' }>,
  ): void {
    const approval = repos.approvals.create({
      id: event.approvalId,
      threadId: thread.id,
      toolCallId: event.toolCallId,
      toolName: event.name,
      input: event.input,
      createdAt: nowIso(),
    });
    repos.turns.setStatus(turnId, 'needs-approval');
    const updated = setThreadStatus(thread, 'needs-approval');
    bus.emit({
      kind: 'event',
      type: 'approval.requested',
      threadId: thread.id,
      payload: approval,
    });
    logger.debug('approval requested', {
      threadId: thread.id,
      turnId,
      approvalId: approval.id,
      status: updated.status,
    });
  }

  async function runTurn(
    thread: Thread,
    kind: string,
    turnId: string,
    session: AdapterSession,
    text: string,
    ctx: TurnContext,
    state: TurnText,
    sections: readonly ContextSectionInput[],
    limits: ModelLimits,
  ): Promise<void> {
    let settled = false;
    try {
      for await (const event of session.send(text, ctx)) {
        if (event.type === 'text.delta') state.text += event.text;
        if (event.type === 'turn.finished') {
          // Persist the assistant row before the event is broadcast, so a client that
          // refetches on turn.finished already sees it.
          finishTurn(thread, turnId, event.reason);
          settled = true;
        }
        appendEvent(thread.id, event);
        if (event.type === 'approval.requested') requestApproval(thread, turnId, event);
      }
      if (!settled) {
        appendEvent(thread.id, {
          type: 'error',
          message: `${kind}: adapter ended without turn.finished`,
          retryable: false,
        });
        finishTurn(thread, turnId, 'error');
        appendEvent(thread.id, { type: 'turn.finished', turnId, reason: 'error' });
      }
    } catch (error) {
      if (settled) {
        logger.warn('adapter failed after the turn settled', {
          threadId: thread.id,
          turnId,
        });
      } else {
        appendEvent(thread.id, {
          type: 'error',
          message: `${kind}: ${errorMessage(error)}`,
          retryable: false,
        });
        finishTurn(thread, turnId, 'error');
        appendEvent(thread.id, { type: 'turn.finished', turnId, reason: 'error' });
      }
    } finally {
      turnText.delete(turnId);
      const current = active.get(thread.id);
      if (current?.turnId === turnId) active.delete(thread.id);
      try {
        emitContext(thread, sections, {
          excludeMessageId: userMessageId(turnId),
          compacted: false,
          limits,
        });
      } catch {
        logger.warn('context accounting failed after turn', { threadId: thread.id, turnId });
      }
    }
  }

  function failBeforeRun(thread: Thread, turnId: string, kind: string, error: unknown): never {
    const hint = error instanceof AdapterUnavailableError ? ` ${error.hint}` : '';
    const detail = `${errorMessage(error)}${hint}`;
    appendEvent(thread.id, {
      type: 'error',
      message: `${kind}: ${detail}`,
      retryable: false,
    });
    repos.turns.finish(turnId, 'failed', nowIso());
    setThreadStatus(thread, 'failed');
    if (error instanceof AdapterUnavailableError) {
      throw new RpcError('provider-unavailable', detail);
    }
    throw new Error('adapter creation failed');
  }

  return {
    async send(threadId, text, attachments = []) {
      const thread = repos.threads.get(threadId);
      if (thread === undefined) throw notFound('thread not found');
      const project = repos.projects.get(thread.projectId);
      if (project === undefined) throw notFound('project not found');
      const provider = repos.providers.get(thread.providerId);
      if (provider === undefined) throw notFound('provider not found');
      if (!provider.enabled) throw new RpcError('provider-unavailable', 'provider is disabled');
      if (active.has(thread.id)) throw conflict('thread already has an active turn');
      if (text.trim().length === 0 && attachments.length === 0) {
        throw badRequest('message text is empty');
      }
      const worktreePath = thread.worktreePath;
      if (worktreePath === null) throw conflict('thread has no worktree');

      const turnAttachments = resolveAttachments(worktreePath, attachments);
      const now = new Date();
      const createdAt = now.toISOString();
      const turnId = newId('turn');
      const settings = deps.settings();
      const limits = threadLimits(repos, thread, settings);
      const { assembly, brain } = planPrompt(repos, {
        thread,
        project,
        message: text,
        settings,
        now,
      });
      // Token counts only: prompt text can contain user content and never belongs in logs.
      logger.debug('prompt assembled', {
        threadId: thread.id,
        turnId,
        sections: assembly.sections.map(({ name, tokens }) => ({ name, tokens })),
        total: assembly.total,
      });

      recordTurnStart(repos, {
        threadId: thread.id,
        turnId,
        text,
        injectedIds: brain.injectedIds,
        createdAt,
      });
      // A rule the user states mid-chat is stored for the following turn; a capture
      // failure is a brain problem, never a reason to fail the turn.
      try {
        const captured = captureStandingRules(repos, {
          text,
          projectId: thread.projectId,
          threadId: thread.id,
        });
        if (captured.length > 0) {
          logger.debug('standing rules captured', { threadId: thread.id, turnId, ids: captured });
        }
      } catch (error) {
        logger.warn('standing rule capture failed', {
          threadId: thread.id,
          turnId,
          reason: errorMessage(error),
        });
      }
      if (brain.injectedIds.length > 0) repos.brain.touch(brain.injectedIds, createdAt);

      const adapterKey = `${provider.id}:${thread.modelId}`;
      let session: AdapterSession;
      const cached = sessions.get(thread.id);
      if (cached !== undefined && cached.adapterKey === adapterKey) {
        session = cached.session;
      } else {
        if (cached !== undefined) {
          sessions.delete(thread.id);
          await cached.session.dispose().catch(() => {
            logger.warn('cached session dispose failed', { threadId: thread.id });
          });
        }
        let created: AdapterSession;
        try {
          const secret =
            provider.secretRef === null
              ? null
              : await deps.secrets.get(provider.secretRef).catch(() => null);
          created = await deps.createAdapter(provider, secret);
        } catch (error) {
          failBeforeRun(thread, turnId, provider.kind, error);
        }
        session = created;
        sessions.set(thread.id, { session: created, adapterKey });
      }

      // The current user message already lives in the prompt sections, so its row is
      // excluded from the conversation half of the estimate.
      const excludeMessageId = userMessageId(turnId);
      const preUsage = measureContext(repos, thread, assembly.sections, {
        excludeMessageId,
        limits,
      });
      let compacted = false;
      if (
        preUsage.percent >= settings.contextWarningThreshold &&
        settings.autoCompact &&
        session.compact !== undefined
      ) {
        try {
          const result = await session.compact();
          compacted = result.removed > 0;
          logger.debug('context compacted before turn', {
            threadId: thread.id,
            turnId,
            removed: result.removed,
          });
        } catch (error) {
          // Compaction is an optimization: a failed summary keeps history as it was.
          logger.warn('context compaction failed', {
            threadId: thread.id,
            turnId,
            reason: errorMessage(error),
          });
        }
      }
      emitContext(thread, assembly.sections, { excludeMessageId, compacted, limits });

      const controller = new AbortController();
      const ctx: TurnContext = {
        turnId,
        cwd: worktreePath,
        systemPrompt: assembly.systemPrompt,
        permissionMode: thread.permissionMode,
        model: thread.modelId,
        brainSlice: '',
        attachments: turnAttachments,
        signal: controller.signal,
        toolAllowlist: settings.enabledTools,
        maxToolIterations: settings.maxToolIterations,
        maxOutputTokens: limits.maxOutputTokens,
      };
      active.set(thread.id, { session, turnId, controller, adapterKey });
      setThreadStatus(thread, 'running');
      const state: TurnText = { text: '', persisted: false };
      turnText.set(turnId, state);
      void runTurn(
        thread,
        provider.kind,
        turnId,
        session,
        text,
        ctx,
        state,
        assembly.sections,
        limits,
      );
      return { turnId };
    },

    async interrupt(threadId) {
      const thread = repos.threads.get(threadId);
      if (thread === undefined) throw notFound('thread not found');
      const run = active.get(threadId);
      if (run === undefined) {
        if (thread.status === 'running' || thread.status === 'needs-approval') {
          throw conflict('no active run to interrupt');
        }
        return;
      }
      denyPending(threadId);
      await run.session.interrupt().catch(() => {
        logger.warn('adapter interrupt failed', { threadId, turnId: run.turnId });
      });
      run.controller.abort();
      const turn = repos.turns.get(run.turnId);
      if (turn !== undefined && (turn.status === 'running' || turn.status === 'needs-approval')) {
        repos.turns.finish(run.turnId, 'interrupted', nowIso());
        persistAssistant(threadId, run.turnId, 'interrupted');
      }
      setThreadStatus(thread, 'ready-to-review');
    },

    async approve(threadId, approvalId, decision) {
      const approval = repos.approvals.get(approvalId);
      if (approval === undefined || approval.threadId !== threadId) {
        throw notFound('approval not found');
      }
      if (approval.decision !== 'pending') throw conflict('approval already resolved');
      const thread = repos.threads.get(threadId);
      if (thread === undefined) throw notFound('thread not found');
      const run = active.get(threadId);
      if (run === undefined) {
        repos.approvals.resolve(approvalId, 'deny', nowIso());
        setThreadStatus(thread, 'failed');
        throw conflict('no active run for this approval');
      }
      repos.approvals.resolve(approvalId, decision, nowIso());
      run.session.approve(approvalId, decision);
      repos.turns.setStatus(run.turnId, 'running');
      setThreadStatus(thread, 'running');
    },

    async disposeThread(threadId) {
      denyPending(threadId);
      const run = active.get(threadId);
      if (run !== undefined) {
        await run.session.interrupt().catch(() => undefined);
        run.controller.abort();
        active.delete(threadId);
      }
      const cached = sessions.get(threadId);
      sessions.delete(threadId);
      if (cached !== undefined) {
        await cached.session.dispose().catch(() => {
          logger.warn('session dispose failed', { threadId });
        });
      }
    },

    async disposeAll() {
      const ids = new Set([...active.keys(), ...sessions.keys()]);
      for (const id of ids) {
        await this.disposeThread(id);
      }
    },

    recoverOrphanedRuns() {
      const at = nowIso();
      for (const turn of repos.turns.listActive()) {
        repos.turns.finish(turn.id, 'failed', at);
        const thread = repos.threads.get(turn.threadId);
        if (thread === undefined) continue;
        for (const approval of repos.approvals.listPending(thread.id)) {
          repos.approvals.resolve(approval.id, 'deny', at);
        }
        setThreadStatus(thread, 'failed');
        appendEvent(thread.id, {
          type: 'error',
          message: 'server restarted before the turn finished',
          retryable: false,
        });
        appendEvent(thread.id, { type: 'turn.finished', turnId: turn.id, reason: 'error' });
        logger.warn('orphaned turn failed at startup', {
          threadId: thread.id,
          turnId: turn.id,
        });
      }
    },

    listActive: () =>
      [...active.entries()].map(([threadId, run]) => ({
        threadId,
        turnId: run.turnId,
        adapterKey: run.adapterKey,
      })),
  };
}
