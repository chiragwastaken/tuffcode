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
import { threadLimits, threadVision, type ModelLimits } from '../context/limits.js';
import { measureContext } from '../context/service.js';
import type { ContextSectionInput } from '../context/usage.js';
import type { ProviderRecord, Repos, TurnStatus } from '../db/repos/index.js';
import { badRequest, conflict, notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
import { planPrompt } from '../prompt/service.js';
import { deriveTitle, isPlaceholderTitle } from '../titles.js';
import {
  buildHandoffDigest,
  isCouncilThread,
  turnReasoningEffort,
  turnToolPolicy,
} from './turn-options.js';
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

/**
 * Per-turn state that outlives a single settle attempt. `settled` makes the settle path
 * idempotent, and `cancelled` is the fence that keeps a stopped run from writing again.
 */
interface TurnState {
  text: string;
  persisted: boolean;
  settled: boolean;
  cancelled: boolean;
}

type SettleReason = 'complete' | 'interrupted' | 'error';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function turnStatusFor(reason: SettleReason): TurnStatus {
  if (reason === 'complete') return 'complete';
  if (reason === 'interrupted') return 'interrupted';
  return 'failed';
}

/** Written alone when a turn is stopped before any text streamed. */
const INTERRUPTED_LABEL = '[interrupted]';

/** Appended to whatever streamed when the user interrupts, so the row is not read as final. */
export const INTERRUPTED_MARKER = `\n\n${INTERRUPTED_LABEL}`;

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

/**
 * Resolves each attachment into the shape an adapter reads. A path attachment must stay
 * inside the worktree; an inline attachment is already bytes and only needs its kind.
 */
function resolveAttachments(
  worktreePath: string,
  attachments: readonly Attachment[],
): TurnContext['attachments'] {
  return attachments.map((attachment) => {
    const kind = attachment.mimeType?.startsWith('image/') === true ? 'image' : 'file';
    const name = attachment.name.length > 0 ? { name: attachment.name } : {};
    if (attachment.data !== undefined) {
      return {
        ...name,
        data: attachment.data,
        ...(attachment.mimeType === undefined ? {} : { mimeType: attachment.mimeType }),
        kind,
      };
    }
    if (attachment.path === undefined) {
      throw badRequest(`attachment has neither a path nor inline data: ${attachment.name}`);
    }
    let resolved: string;
    try {
      resolved = resolveWithin(worktreePath, attachment.path);
    } catch {
      throw badRequest(`attachment escapes the worktree: ${attachment.name}`);
    }
    return {
      ...name,
      path: resolved,
      ...(attachment.mimeType === undefined ? {} : { mimeType: attachment.mimeType }),
      kind,
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
  /** Streamed text plus settlement and cancellation state per in-flight turn. */
  const turnState = new Map<string, TurnState>();

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
    // One timestamp per event, so the persisted row and the live frame agree.
    const createdAt = nowIso();
    const seq = repos.events.append(threadId, event.type, event, createdAt);
    bus.emit({
      kind: 'event',
      type: 'thread.event',
      threadId,
      seq,
      createdAt,
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

  /**
   * Stores the streamed assistant text once per turn. An interrupted turn always leaves
   * a row, even when nothing streamed, so the timeline shows where the run stopped.
   */
  function persistAssistant(
    threadId: string,
    turnId: string,
    reason: SettleReason,
    state: TurnState | undefined,
  ): void {
    const text = state?.text ?? '';
    if (state !== undefined) {
      if (state.persisted) return;
      state.persisted = true;
    }
    if (text.length === 0 && reason !== 'interrupted') return;
    const content =
      reason === 'interrupted'
        ? `${text}${text.length === 0 ? INTERRUPTED_LABEL : INTERRUPTED_MARKER}`
        : text;
    repos.messages.addIfAbsent({
      id: assistantMessageId(turnId),
      threadId,
      role: 'assistant',
      content,
      createdAt: nowIso(),
    });
  }

  /**
   * The single settle path for a turn. The adapter's own turn.finished, an adapter
   * failure, a failed adapter creation, an interrupt, and orphan recovery all land
   * here, so a turn gets exactly one turn row write, one assistant row, one thread
   * status write, and one turn.finished event. Later calls for the same turn are
   * no-ops, which is what lets a late adapter error lose to an interrupt.
   */
  function settleTurn(
    thread: Thread,
    turnId: string,
    reason: SettleReason,
    state: TurnState | undefined,
  ): void {
    if (state !== undefined) {
      if (state.settled) return;
      state.settled = true;
    }
    const existing = repos.turns.get(turnId);
    // Durable fence: a row that already carries finished_at was settled by an earlier
    // call, even when the in-memory state is gone (recovery, a cancelled run that
    // outlived its state).
    if (existing !== undefined && existing.finishedAt !== null) return;
    repos.turns.finish(turnId, turnStatusFor(reason), nowIso());
    persistAssistant(thread.id, turnId, reason, state);
    denyPending(thread.id);
    setThreadStatus(thread, reason === 'error' ? 'failed' : 'ready-to-review');
    appendEvent(thread.id, { type: 'turn.finished', turnId, reason });
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
    state: TurnState,
    sections: readonly ContextSectionInput[],
    limits: ModelLimits,
  ): Promise<void> {
    try {
      for await (const event of session.send(text, ctx)) {
        // The fence: a cancelled or settled turn takes no further adapter input. The
        // interrupt already wrote its boundary, so a late delta, approval, or finish
        // must not land in the log or move the thread.
        if (state.cancelled || state.settled) break;
        if (event.type === 'text.delta') state.text += event.text;
        if (event.type === 'turn.finished') {
          // Persist and broadcast the boundary before anything else observes it.
          settleTurn(thread, turnId, event.reason, state);
          continue;
        }
        appendEvent(thread.id, event);
        if (event.type === 'approval.requested') requestApproval(thread, turnId, event);
      }
      if (!state.settled && !state.cancelled) {
        appendEvent(thread.id, {
          type: 'error',
          message: `${kind}: adapter ended without turn.finished`,
          retryable: false,
        });
        settleTurn(thread, turnId, 'error', state);
      }
    } catch (error) {
      if (state.settled || state.cancelled) {
        // An interrupt or a normal finish already settled this turn; the throw is the
        // cancelled stream unwinding and must not append an error or flip the status.
        logger.warn('adapter failed after the turn settled', {
          threadId: thread.id,
          turnId,
          reason: errorMessage(error),
        });
      } else {
        appendEvent(thread.id, {
          type: 'error',
          message: `${kind}: ${errorMessage(error)}`,
          retryable: false,
        });
        settleTurn(thread, turnId, 'error', state);
      }
    } finally {
      turnState.delete(turnId);
      // Only this run may clear its own slot: an interrupt followed by a send leaves a
      // newer turn in the map, and this run must not fence it off.
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
    settleTurn(thread, turnId, 'error', undefined);
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
      // The first message names a thread that still carries its placeholder title; a
      // title the user typed is never touched. setThreadStatus below emits the new row.
      if (isPlaceholderTitle(thread.title)) {
        const title = deriveTitle(text);
        if (title !== null) repos.threads.update(thread.id, { title, updatedAt: createdAt });
      }
      // A rule the user states mid-chat is stored for the following turn; a capture
      // failure is a brain problem, never a reason to fail the turn.
      try {
        // Paused memory (brainCapture off) still recalls; it only stops new writes.
        const captured = !settings.brainEnabled || !settings.brainCapture ? [] : captureStandingRules(repos, {
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
      // A fresh adapter session has none of the thread's earlier turns (a provider or
      // model switch, or a restart), so its first turn carries a bounded digest.
      let freshSession = false;
      const cached = sessions.get(thread.id);
      if (cached !== undefined && cached.adapterKey === adapterKey) {
        session = cached.session;
      } else {
        freshSession = true;
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
      const handoff = freshSession
        ? buildHandoffDigest(
            repos.messages.list(thread.id).filter((message) => message.id !== excludeMessageId),
          )
        : null;
      const policy = turnToolPolicy({ settings, council: isCouncilThread(repos, thread) });
      const effort = turnReasoningEffort(thread, provider.config);
      const ctx: TurnContext = {
        turnId,
        threadId: thread.id,
        cwd: worktreePath,
        systemPrompt:
          handoff === null ? assembly.systemPrompt : `${assembly.systemPrompt}\n\n${handoff}`,
        permissionMode: thread.permissionMode,
        model: thread.modelId,
        brainSlice: '',
        attachments: turnAttachments,
        vision: threadVision(repos, thread),
        signal: controller.signal,
        ...(policy.toolAllowlist === undefined ? {} : { toolAllowlist: policy.toolAllowlist }),
        toolOptions: policy.toolOptions,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
        maxToolIterations: settings.maxToolIterations,
        maxOutputTokens: limits.maxOutputTokens,
      };
      active.set(thread.id, { session, turnId, controller, adapterKey });
      setThreadStatus(thread, 'running');
      const state: TurnState = { text: '', persisted: false, settled: false, cancelled: false };
      turnState.set(turnId, state);
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
      // Fence the run before the adapter is asked to stop, and before the first await:
      // the next send() must see no active run and no cached session, so it builds a
      // fresh adapter instead of attaching to the cancelled one. The settle is
      // synchronous and idempotent, so a second interrupt cannot finish twice.
      const state = turnState.get(run.turnId);
      if (state !== undefined) state.cancelled = true;
      denyPending(threadId);
      active.delete(threadId);
      const cached = sessions.get(threadId);
      sessions.delete(threadId);
      settleTurn(thread, run.turnId, 'interrupted', state);
      run.controller.abort();

      await run.session.interrupt().catch(() => {
        logger.warn('adapter interrupt failed', { threadId, turnId: run.turnId });
      });
      const disposable = cached?.session ?? run.session;
      await disposable.dispose().catch(() => {
        logger.warn('interrupted session dispose failed', { threadId, turnId: run.turnId });
      });
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
      for (const turn of repos.turns.listActive()) {
        const thread = repos.threads.get(turn.threadId);
        if (thread === undefined) {
          repos.turns.finish(turn.id, 'failed', nowIso());
          continue;
        }
        appendEvent(thread.id, {
          type: 'error',
          message: 'server restarted before the turn finished',
          retryable: false,
        });
        // Recovery has no in-flight state, so the durable finished_at fence keeps a
        // repeated recovery from writing a second boundary.
        settleTurn(thread, turn.id, 'error', undefined);
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
