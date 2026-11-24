import type {
  AdapterEvent,
  PermissionMode,
  Settings,
  SubagentSpec,
  SubagentStatus,
  SubagentType,
  SubagentView,
  Thread,
} from '@tuffcode/contracts';
import { buildSubagentMessage, estimateTokens, parseNotetakerFacts } from '@tuffcode/prompt';
import { newId, worktreesRoot, type Logger } from '@tuffcode/shared';
import { createBrainStore, type BrainStore } from '../brain/store.js';
import type { Repos, SubagentRecord } from '../db/repos/index.js';
import { toSubagentView } from '../db/repos/index.js';
import { badRequest, conflict, notFound, RpcError } from '../errors.js';
import type { EventBus } from '../events.js';
import { provisionWorktree, removeWorktree } from '../git/index.js';
import type { Runner } from '../runner/runner.js';
import type {
  SubagentChildRequest,
  SubagentPorts,
  SubagentSpawnInput,
  SubagentTarget,
  SubagentTargetSource,
  SubagentTurnInput,
  SubagentTurnResult,
  Subagents,
} from './types.js';

export interface SubagentDeps {
  repos: Repos;
  bus: EventBus;
  runner: Runner;
  logger: Logger;
  settings: () => Settings;
  /** Test seam: any port may be replaced by a fake. */
  ports?: Partial<SubagentPorts>;
  brain?: BrainStore;
}

/** A child that never states a budget is capped here, so one run cannot burn the thread. */
export const DEFAULT_SUBAGENT_BUDGET_TOKENS = 120_000;

/** Summaries travel through events and the subagents table, so they stay bounded. */
const SUMMARY_LIMIT = 4000;

/** Read-only types can only inspect the parent worktree; only a worker gets a checkout. */
const READ_ONLY_TYPES: Partial<Record<SubagentType, true>> = {
  explorer: true,
  reviewer: true,
  notetaker: true,
  planner: true,
};

export function permissionForSubagent(type: SubagentType): PermissionMode {
  return READ_ONLY_TYPES[type] === true ? 'read-only' : 'accept-edits';
}

export function subagentWorktree(type: SubagentType): boolean {
  return type === 'worker';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 3)}...`;
}

/**
 * Picks the provider and model for one child. Order: an explicit spec model, the
 * per-type setting, that setting's fallback model, then the parent thread's own model.
 * A candidate whose provider is missing or disabled is skipped; when the configured
 * provider is unusable the fallback model runs on the parent thread's provider, so a
 * stale settings entry degrades instead of failing the spawn.
 */
export function resolveSubagentTarget(input: {
  spec: SubagentSpec;
  thread: Thread;
  settings: Settings;
  providerUsable: (providerId: string) => boolean;
}): SubagentTarget {
  const choice = input.settings.subagentModels[input.spec.type];
  const parentProvider = input.thread.providerId;
  const configured = choice.providerId?.trim();
  const configuredUsable = configured !== undefined && input.providerUsable(configured);
  const candidates: SubagentTarget[] = [];
  const push = (
    model: string | undefined,
    providerId: string,
    source: SubagentTargetSource,
  ): void => {
    if (model === undefined || model.trim().length === 0) return;
    candidates.push({ providerId, model: model.trim(), source });
  };

  const specProvider = input.spec.providerId?.trim();
  push(
    input.spec.model,
    specProvider === undefined || specProvider.length === 0
      ? (configured ?? parentProvider)
      : specProvider,
    'spec',
  );
  push(choice.model, configured ?? parentProvider, 'settings');
  push(choice.fallbackModel, configuredUsable ? configured : parentProvider, 'fallback');
  push(input.thread.modelId, parentProvider, 'thread');

  const usable = candidates.find((candidate) => input.providerUsable(candidate.providerId));
  if (usable === undefined) {
    throw new RpcError(
      'provider-unavailable',
      `no usable provider for the ${input.spec.type} subagent`,
    );
  }
  return usable;
}

/**
 * Runs one child turn by watching the bus, the same shape the council turn runner
 * uses. The runner owns the turn, so the service subscribes before `send`, buffers
 * text, forwards every adapter event, and settles on the `turn.finished` frame for
 * the turn id `send` returned. Abort settles as interrupted without waiting.
 */
function createChildTurnRunner(deps: { bus: EventBus; runner: Runner }) {
  return async (input: SubagentTurnInput): Promise<SubagentTurnResult> => {
    if (input.signal.aborted) return { status: 'interrupted', text: '' };

    let buffer = '';
    let currentTurnId: string | null = null;
    const finished: { value: { turnId: string; reason: SubagentTurnResult['status'] } | null } = {
      value: null,
    };
    let settled = false;
    const { promise, resolve } = Promise.withResolvers<SubagentTurnResult>();
    const settle = (result: SubagentTurnResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const unsubscribe = deps.bus.subscribe((event) => {
      if (event.type !== 'thread.event' || event.threadId !== input.threadId) return;
      const payload = event.payload;
      input.onEvent(payload);
      if (payload.type === 'text.delta') {
        buffer += payload.text;
        return;
      }
      if (payload.type !== 'turn.finished') return;
      finished.value = { turnId: payload.turnId, reason: payload.reason };
      if (currentTurnId === payload.turnId) {
        settle({ status: payload.reason, text: buffer });
      }
    });

    const onAbort = (): void => {
      settle({ status: 'interrupted', text: buffer });
    };
    input.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const sent = await deps.runner.send(input.threadId, input.text);
      currentTurnId = sent.turnId;
      if (finished.value !== null && finished.value.turnId === sent.turnId) {
        settle({ status: finished.value.reason, text: buffer });
      }
    } catch (error) {
      settle({ status: 'error', text: buffer, error: errorMessage(error) });
    }

    try {
      return await promise;
    } finally {
      unsubscribe();
      input.signal.removeEventListener('abort', onAbort);
    }
  };
}

interface ChildRun {
  childId: string;
  parentThreadId: string;
  controller: AbortController;
  cancelled: boolean;
  childThreadId: string | null;
}

/**
 * Typed subagent runtime: one persisted row and one child session per spawn, a
 * per-parent queue capped by `subagentConcurrency`, a per-child token budget, and
 * events routed to the parent thread under the child id. A failed child never fails
 * the parent turn; cancel is per child.
 */
export function createSubagents(deps: SubagentDeps): Subagents {
  const { repos, bus, logger } = deps;
  const overrides = deps.ports ?? {};
  const brain = deps.brain ?? createBrainStore(repos.brain);
  const runTurn = createChildTurnRunner({ bus, runner: deps.runner });

  const ports: SubagentPorts = {
    createChildThread:
      overrides.createChildThread?.bind(overrides) ??
      ((request) => createChildThread(repos, deps.settings(), request)),
    runTurn: overrides.runTurn?.bind(overrides) ?? runTurn,
  };

  /** Parent thread id -> child ids waiting for a slot, in spawn order. */
  const queues = new Map<string, string[]>();
  /** Parent thread id -> children currently holding a slot. */
  const running = new Map<string, number>();
  const active = new Map<string, ChildRun>();
  const settled = new Set<string>();
  const waiters = new Map<string, (view: SubagentView) => void>();

  function requireRecord(childId: string): SubagentRecord {
    const record = repos.subagents.get(childId);
    if (record === undefined) throw notFound('subagent not found');
    return record;
  }

  function emitFinished(record: SubagentRecord): void {
    bus.emit({
      kind: 'event',
      type: 'subagent.finished',
      threadId: record.threadId,
      payload: {
        childId: record.childId,
        threadId: record.threadId,
        status: record.status,
        ...(record.summary === undefined ? {} : { summary: record.summary }),
      },
    });
  }

  /** Settles a child exactly once, whatever the caller (run loop, cancel, failure). */
  function finish(
    childId: string,
    status: SubagentStatus,
    summary: string | null = null,
  ): SubagentRecord | undefined {
    const existing = repos.subagents.get(childId);
    if (existing === undefined) return undefined;
    if (settled.has(childId)) return existing;
    settled.add(childId);
    const record = repos.subagents.finish(childId, {
      status,
      summary: summary === null ? null : truncate(summary, SUMMARY_LIMIT),
      updatedAt: nowIso(),
    });
    const view = toSubagentView(record ?? existing);
    const waiter = waiters.get(childId);
    if (waiter !== undefined) {
      waiters.delete(childId);
      waiter(view);
    }
    if (record !== undefined) emitFinished(record);
    return record;
  }

  function pump(parentThreadId: string): void {
    const cap = Math.max(1, deps.settings().subagentConcurrency);
    for (;;) {
      if ((running.get(parentThreadId) ?? 0) >= cap) return;
      const queue = queues.get(parentThreadId);
      const childId = queue?.shift();
      if (childId === undefined) return;
      running.set(parentThreadId, (running.get(parentThreadId) ?? 0) + 1);
      void runChild(childId).finally(() => {
        running.set(parentThreadId, Math.max(0, (running.get(parentThreadId) ?? 1) - 1));
        pump(parentThreadId);
      });
    }
  }

  async function runChild(childId: string): Promise<void> {
    const record = repos.subagents.get(childId);
    if (record === undefined || record.status !== 'queued') return;
    const parent = repos.threads.get(record.threadId);
    if (parent === undefined) {
      finish(childId, 'failed', 'parent thread no longer exists');
      return;
    }

    const run: ChildRun = {
      childId,
      parentThreadId: parent.id,
      controller: new AbortController(),
      cancelled: false,
      childThreadId: null,
    };
    active.set(childId, run);
    repos.subagents.setRunning(childId, null, nowIso());
    bus.emit({
      kind: 'event',
      type: 'subagent.started',
      threadId: parent.id,
      payload: {
        childId,
        threadId: parent.id,
        type: record.type,
        model: record.model,
      },
    });

    try {
      let child: Thread;
      try {
        child = await ports.createChildThread({
          parent,
          type: record.type,
          providerId: record.providerId,
          modelId: record.model,
          permissionMode: permissionForSubagent(record.type),
          worktree: subagentWorktree(record.type),
        });
      } catch (error) {
        finish(childId, 'failed', `child session could not start: ${errorMessage(error)}`);
        return;
      }
      run.childThreadId = child.id;
      // Cancel can land while the checkout is being provisioned; the row must stay
      // cancelled and the child turn must never start.
      if (run.cancelled || run.controller.signal.aborted) {
        finish(childId, 'cancelled', 'cancelled before the child turn started');
        return;
      }
      repos.subagents.setRunning(childId, child.id, nowIso());

      const project = repos.projects.get(parent.projectId);
      const budget = record.budgetTokens ?? DEFAULT_SUBAGENT_BUDGET_TOKENS;
      const text = buildSubagentMessage({
        type: record.type,
        task: record.task,
        ...(child.worktreePath === null ? {} : { cwd: child.worktreePath }),
        ...(project === undefined ? {} : { projectName: project.name }),
        parentTitle: parent.title,
      });

      let used = 0;
      let exceeded = false;
      const onEvent = (event: AdapterEvent): void => {
        bus.emit({
          kind: 'event',
          type: 'subagent.event',
          threadId: parent.id,
          payload: { childId, threadId: parent.id, event },
        });
        if (event.type !== 'text.delta') return;
        used += estimateTokens(event.text);
        if (used <= budget || exceeded) return;
        exceeded = true;
        logger.warn('subagent token budget exceeded', { childId, budget });
        run.controller.abort();
        void deps.runner.interrupt(child.id).catch(() => undefined);
      };

      const result = await ports.runTurn({
        threadId: child.id,
        text,
        signal: run.controller.signal,
        onEvent,
      });

      if (exceeded) {
        finish(
          childId,
          'failed',
          `Token budget of ${budget} exceeded before the child finished.\n\n${result.text}`,
        );
        return;
      }
      if (run.cancelled) {
        finish(childId, 'cancelled', result.text);
        return;
      }
      if (result.status === 'complete') {
        finish(childId, 'done', await summarize(record, parent, result.text));
        return;
      }
      if (result.status === 'interrupted') {
        finish(childId, 'failed', 'child turn was interrupted');
        return;
      }
      finish(childId, 'failed', result.error ?? result.text);
    } finally {
      active.delete(childId);
    }
  }

  /**
   * A notetaker's answer is a JSON fact list; the service owns the brain write so a
   * read-only child never needs a write tool. Other types return their text as is.
   */
  async function summarize(record: SubagentRecord, parent: Thread, text: string): Promise<string> {
    if (record.type !== 'notetaker') return text;
    const facts = parseNotetakerFacts(text);
    if (facts.length === 0 || !deps.settings().brainEnabled) return text;
    let stored = 0;
    for (const fact of facts) {
      try {
        brain.upsert({
          kind: 'project',
          scope: 'project',
          projectId: parent.projectId,
          text: fact.text,
          tags: fact.tags,
          importance: fact.importance,
        });
        stored += 1;
      } catch (error) {
        logger.warn('notetaker fact could not be stored', {
          childId: record.childId,
          message: errorMessage(error),
        });
      }
    }
    return `Recorded ${stored} of ${facts.length} facts in the brain.\n\n${text}`;
  }

  function resolveThreadForCwd(cwd: string): Thread | undefined {
    const childThreads = new Set(
      repos.subagents
        .listAll()
        .map((record) => record.childThreadId)
        .filter((id): id is string => id !== null),
    );
    const normalized = cwd.trim().toLowerCase();
    const candidates = repos.threads
      .list()
      .filter((thread) => thread.worktreePath !== null && !childThreads.has(thread.id))
      .filter((thread) => thread.worktreePath?.trim().toLowerCase() === normalized)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return candidates[0];
  }

  async function spawnChild({ threadId, spec }: SubagentSpawnInput): Promise<{ childId: string }> {
    const parent = repos.threads.get(threadId);
    if (parent === undefined) throw notFound('thread not found');
    if (spec.task.trim().length === 0) throw badRequest('subagent task is empty');
    const target = resolveSubagentTarget({
      spec,
      thread: parent,
      settings: deps.settings(),
      providerUsable: (providerId) => repos.providers.get(providerId)?.enabled === true,
    });

    const childId = newId('sub');
    const createdAt = nowIso();
    repos.subagents.create({
      childId,
      threadId: parent.id,
      type: spec.type,
      providerId: target.providerId,
      model: target.model,
      status: 'queued',
      task: spec.task,
      budgetTokens: spec.budgetTokens ?? DEFAULT_SUBAGENT_BUDGET_TOKENS,
      createdAt,
    });
    logger.debug('subagent queued', {
      childId,
      threadId: parent.id,
      type: spec.type,
      model: target.model,
      source: target.source,
    });

    const queue = queues.get(parent.id) ?? [];
    queue.push(childId);
    queues.set(parent.id, queue);
    pump(parent.id);
    return { childId };
  }

  return {
    spawn: spawnChild,

    async spawnFromTool(request) {
      const parent = resolveThreadForCwd(request.cwd);
      if (parent === undefined) {
        throw new RpcError('bad-request', 'no thread owns this worktree');
      }
      if (parent.permissionMode === 'read-only') {
        throw new RpcError('bad-request', 'subagents cannot be spawned from a read-only turn');
      }
      const spec: SubagentSpec = {
        type: request.type,
        task: request.task,
        ...(request.model === undefined ? {} : { model: request.model }),
      };
      const { childId } = await spawnChild({ threadId: parent.id, spec });
      const record = repos.subagents.get(childId);
      return { childId, status: record?.status ?? 'queued' };
    },

    async cancel(childId) {
      const record = requireRecord(childId);
      if (record.status === 'queued') {
        const queue = queues.get(record.threadId);
        if (queue !== undefined) {
          queues.set(
            record.threadId,
            queue.filter((id) => id !== childId),
          );
        }
        finish(childId, 'cancelled', 'cancelled before it started');
        return;
      }
      if (record.status !== 'running') return;
      const run = active.get(childId);
      if (run === undefined) {
        finish(childId, 'cancelled', 'cancelled before it started');
        return;
      }
      run.cancelled = true;
      run.controller.abort();
      if (run.childThreadId !== null) {
        await deps.runner.interrupt(run.childThreadId).catch(() => undefined);
      }
      finish(childId, 'cancelled', 'cancelled by the parent');
    },

    list(threadId) {
      return repos.subagents.listByThread(threadId).map(toSubagentView);
    },

    awaitChild(childId) {
      const record = requireRecord(childId);
      if (settled.has(childId) || (record.status !== 'queued' && record.status !== 'running')) {
        return Promise.resolve(toSubagentView(record));
      }
      const { promise, resolve } = Promise.withResolvers<SubagentView>();
      const existing = waiters.get(childId);
      waiters.set(childId, (view) => {
        existing?.(view);
        resolve(view);
      });
      return promise;
    },

    recoverOrphaned() {
      const failed = repos.subagents.failUnfinished(
        nowIso(),
        'server restarted before the subagent finished',
      );
      if (failed > 0) logger.warn('orphaned subagents failed at startup', { count: failed });
      return failed;
    },

    async dispose() {
      const childIds = new Set([...active.keys(), ...[...queues.values()].flat()]);
      for (const childId of childIds) {
        await this.cancel(childId).catch(() => undefined);
      }
      queues.clear();
      active.clear();
    },
  };
}

/**
 * Creates the child thread row: a worker gets its own worktree on a
 * `tuffcode/<threadId>` branch; every read-only type shares the parent's checkout so
 * it inspects exactly what the parent sees and never touches the main tree.
 */
async function createChildThread(
  repos: Repos,
  settings: Settings,
  request: SubagentChildRequest,
): Promise<Thread> {
  const project = repos.projects.get(request.parent.projectId);
  if (project === undefined) throw notFound('project not found');
  const provider = repos.providers.get(request.providerId);
  if (provider === undefined) throw notFound('provider not found');
  if (!provider.enabled) throw new RpcError('provider-unavailable', 'provider is disabled');

  const id = newId('thr');
  const now = nowIso();
  const title = `Subagent ${request.type} ${id.slice(4, 12)}`;
  const base = {
    id,
    projectId: project.id,
    parentThreadId: request.parent.id,
    title,
    providerId: provider.id,
    modelId: request.modelId,
    executionMode: 'work' as const,
    permissionMode: request.permissionMode,
    status: 'idle' as const,
    createdAt: now,
    updatedAt: now,
  };

  if (!request.worktree) {
    if (request.parent.worktreePath === null) {
      throw conflict('parent thread has no worktree');
    }
    return repos.threads.create({
      ...base,
      worktreePath: request.parent.worktreePath,
      branch: request.parent.branch,
      baseBranch: request.parent.baseBranch,
    });
  }

  const root = settings.worktreeRoot ?? worktreesRoot();
  const worktree = await provisionWorktree({
    repoPath: project.path,
    baseBranch: request.parent.baseBranch ?? project.defaultBranch,
    projectId: project.id,
    threadId: id,
    worktreesRoot: root,
  });
  try {
    return repos.threads.create({
      ...base,
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
    });
  } catch (error) {
    await removeWorktree(project.path, worktree.path).catch(() => undefined);
    throw error;
  }
}
