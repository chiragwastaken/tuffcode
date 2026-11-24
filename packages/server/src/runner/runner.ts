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
import { buildSystemPrompt, buildTurnContext } from '@tuffcode/prompt';
import { newId, resolveWithin, type Logger } from '@tuffcode/shared';
import { assembleBrain, renderBrainSlice } from '../brain/service.js';
import type { ProviderRecord, Repos, TurnStatus } from '../db/repos/index.js';
import { badRequest, conflict, notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
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

  function emitThread(thread: Thread): void {
    bus.emit({ kind: 'event', type: 'thread.updated', threadId: thread.id, payload: thread });
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

  function finishTurn(
    thread: Thread,
    turnId: string,
    reason: 'complete' | 'interrupted' | 'error',
    assistantText: string,
  ): void {
    const at = nowIso();
    repos.turns.finish(turnId, turnStatusFor(reason), at);
    if (assistantText.length > 0) {
      repos.messages.add({
        id: newId('msg'),
        threadId: thread.id,
        role: 'assistant',
        content: assistantText,
        createdAt: at,
      });
    }
    denyPending(thread.id);
    setThreadStatus(thread, reason === 'error' ? 'failed' : 'ready-to-review');
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
  ): Promise<void> {
    let assistantText = '';
    let settled = false;
    try {
      for await (const event of session.send(text, ctx)) {
        appendEvent(thread.id, event);
        if (event.type === 'text.delta') assistantText += event.text;
        else if (event.type === 'approval.requested') requestApproval(thread, turnId, event);
        else if (event.type === 'turn.finished') {
          finishTurn(thread, turnId, event.reason, assistantText);
          settled = true;
        }
      }
      if (!settled) {
        appendEvent(thread.id, {
          type: 'error',
          message: `${kind}: adapter ended without turn.finished`,
          retryable: false,
        });
        appendEvent(thread.id, { type: 'turn.finished', turnId, reason: 'error' });
        finishTurn(thread, turnId, 'error', assistantText);
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
        appendEvent(thread.id, { type: 'turn.finished', turnId, reason: 'error' });
        finishTurn(thread, turnId, 'error', assistantText);
      }
    } finally {
      const current = active.get(thread.id);
      if (current?.turnId === turnId) active.delete(thread.id);
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
      const brain = assembleBrain(repos, deps.settings(), {
        projectId: project.id,
        threadId: thread.id,
        mode: thread.executionMode,
        message: text,
        now,
      });
      const rules = brain.slice.always
        .filter((entry) => entry.kind === 'rule')
        .map((entry) => entry.text);
      const systemPrompt = `${buildSystemPrompt({ extraRules: rules })}\n\n${buildTurnContext({
        date: createdAt.slice(0, 10),
        mode: thread.executionMode,
        cwd: worktreePath,
        projectName: project.name,
        brainSlice: '',
      })}`;

      repos.turns.create({
        id: turnId,
        threadId: thread.id,
        status: 'running',
        injectedIds: brain.injectedIds,
        createdAt,
      });
      repos.messages.add({
        id: newId('msg'),
        threadId: thread.id,
        role: 'user',
        content: text,
        createdAt,
      });
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

      const controller = new AbortController();
      const ctx: TurnContext = {
        turnId,
        cwd: worktreePath,
        systemPrompt,
        permissionMode: thread.permissionMode,
        model: thread.modelId,
        brainSlice: renderBrainSlice(brain.slice),
        attachments: turnAttachments,
        signal: controller.signal,
      };
      active.set(thread.id, { session, turnId, controller, adapterKey });
      setThreadStatus(thread, 'running');
      void runTurn(thread, provider.kind, turnId, session, text, ctx);
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
      if (
        turn !== undefined &&
        (turn.status === 'running' || turn.status === 'needs-approval')
      ) {
        repos.turns.finish(run.turnId, 'interrupted', nowIso());
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
