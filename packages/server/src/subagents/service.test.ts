import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptySubagentModels,
  type ServerEvent,
  type SubagentType,
  type Thread,
} from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { createRepos } from '../db/repos/index.js';
import { createEventBus, type EventBus } from '../events.js';
import type { Runner } from '../runner/runner.js';
import {
  createProjectThread,
  createTestContext,
  initRepo,
  silentLogger,
  type TestContext,
} from '../test-support.js';
import { createSubagents, resolveSubagentTarget } from './service.js';
import { createSubagentHandlers } from './rpc.js';
import type {
  SubagentChildRequest,
  SubagentPorts,
  SubagentTurnInput,
  SubagentTurnResult,
  Subagents,
} from './types.js';

const PARENT_ID = 'thr_parent';
const PARENT_WORKTREE = 'C:/worktrees/parent';

/** One event-loop turn, so pending microtasks and real I/O both progress. */
function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await yieldToEventLoop();
  }
  throw new Error('condition was not reached');
}

function seed(ctx: TestContext): Thread {
  const now = new Date().toISOString();
  ctx.repos.projects.add({
    id: 'prj_1',
    name: 'Demo',
    path: 'C:/demo',
    defaultBranch: 'main',
    createdAt: now,
  });
  ctx.repos.providers.upsert({ id: 'prv_main', kind: 'claude', label: 'Main', config: {} });
  ctx.repos.providers.upsert({ id: 'prv_fast', kind: 'codex', label: 'Fast', config: {} });
  return ctx.repos.threads.create({
    id: PARENT_ID,
    projectId: 'prj_1',
    parentThreadId: null,
    title: 'Parent thread',
    providerId: 'prv_main',
    modelId: 'main-model',
    executionMode: 'work',
    permissionMode: 'ask',
    status: 'idle',
    worktreePath: PARENT_WORKTREE,
    branch: 'tuffcode/thr_parent',
    baseBranch: 'main',
    createdAt: now,
    updatedAt: now,
  });
}

class FakePorts implements SubagentPorts {
  readonly created: SubagentChildRequest[] = [];
  readonly turns: SubagentTurnInput[] = [];
  handler: (input: SubagentTurnInput) => Promise<SubagentTurnResult> = () =>
    Promise.resolve({ status: 'complete', text: 'child summary' });
  block = false;
  /** Holds child thread creation so a cancel can land mid-provisioning. */
  blockCreate = false;
  active = 0;
  maxActive = 0;
  private readonly releases: (() => void)[] = [];
  private readonly createReleases: (() => void)[] = [];

  constructor(private readonly ctx: TestContext) {}

  async createChildThread(request: SubagentChildRequest): Promise<Thread> {
    const id = `thr_child_${this.created.length + 1}`;
    this.created.push(request);
    if (this.blockCreate) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.createReleases.push(resolve);
      await promise;
    }
    const now = new Date().toISOString();
    return this.ctx.repos.threads.create({
      id,
      projectId: request.parent.projectId,
      parentThreadId: request.parent.id,
      title: `Child ${id}`,
      providerId: request.providerId,
      modelId: request.modelId,
      executionMode: 'work',
      permissionMode: request.permissionMode,
      status: 'idle',
      worktreePath: request.worktree ? `C:/worktrees/${id}` : request.parent.worktreePath,
      branch: request.worktree ? `tuffcode/${id}` : request.parent.branch,
      baseBranch: request.parent.baseBranch,
      createdAt: now,
      updatedAt: now,
    });
  }

  async runTurn(input: SubagentTurnInput): Promise<SubagentTurnResult> {
    this.turns.push(input);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.block) {
        const { promise, resolve } = Promise.withResolvers<void>();
        this.releases.push(resolve);
        input.signal.addEventListener('abort', () => resolve(), { once: true });
        await promise;
      }
      if (input.signal.aborted) return { status: 'interrupted', text: '' };
      return await this.handler(input);
    } finally {
      this.active -= 1;
    }
  }

  releaseOne(): void {
    this.releases.shift()?.();
  }

  /** Stops blocking and releases every waiting turn, including ones that start later. */
  unblockAll(): void {
    this.block = false;
    for (;;) {
      const release = this.releases.shift();
      if (release === undefined) return;
      release();
    }
  }

  releaseCreate(): void {
    this.blockCreate = false;
    for (;;) {
      const release = this.createReleases.shift();
      if (release === undefined) return;
      release();
    }
  }
}

interface FakeRunner extends Runner {
  readonly interrupts: string[];
}

function fakeRunner(): FakeRunner {
  const interrupts: string[] = [];
  return {
    interrupts,
    listActive: () => [],
    send: () => Promise.resolve({ turnId: 'turn_unused' }),
    interrupt: (threadId) => {
      interrupts.push(threadId);
      return Promise.resolve();
    },
    approve: () => Promise.resolve(),
    disposeThread: () => Promise.resolve(),
    disposeAll: () => Promise.resolve(),
    recoverOrphanedRuns: () => undefined,
  };
}

interface Harness {
  ctx: TestContext;
  bus: EventBus;
  runner: FakeRunner;
  ports: FakePorts;
  subagents: Subagents;
  events: ServerEvent[];
  dispose(): Promise<void>;
}

function createHarness(options: { concurrency?: number } = {}): Harness {
  const ctx = createTestContext();
  seed(ctx);
  if (options.concurrency !== undefined) {
    ctx.repos.settings.patch({ subagentConcurrency: options.concurrency });
  }
  const bus = createEventBus();
  const events: ServerEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const ports = new FakePorts(ctx);
  const runner = fakeRunner();
  const subagents = createSubagents({
    repos: ctx.repos,
    bus,
    runner,
    logger: silentLogger(),
    settings: () => ctx.repos.settings.get(),
    ports,
  });
  return {
    ctx,
    bus,
    runner,
    ports,
    subagents,
    events,
    dispose: async () => {
      await subagents.dispose();
      ctx.dispose();
    },
  };
}

function spawn(harness: Harness, type: SubagentType, task = `Do ${type} work`): Promise<string> {
  return harness.subagents
    .spawn({ threadId: PARENT_ID, spec: { type, task } })
    .then((result) => result.childId);
}

describe('resolveSubagentTarget', () => {
  it('prefers the spec, then the per-type setting, then its fallback, then the thread', () => {
    const ctx = createTestContext();
    try {
      const thread = seed(ctx);
      const settings = ctx.repos.settings.patch({
        subagentModels: {
          ...emptySubagentModels(),
          explorer: { providerId: 'prv_fast', model: 'fast-model', fallbackModel: 'slow-model' },
        },
      });
      const providerUsable = (id: string): boolean => ctx.repos.providers.get(id)?.enabled === true;

      expect(
        resolveSubagentTarget({
          spec: { type: 'explorer', task: 'x', model: 'explicit' },
          thread,
          settings,
          providerUsable,
        }),
      ).toEqual({ providerId: 'prv_fast', model: 'explicit', source: 'spec' });

      expect(
        resolveSubagentTarget({
          spec: { type: 'explorer', task: 'x' },
          thread,
          settings,
          providerUsable,
        }),
      ).toEqual({ providerId: 'prv_fast', model: 'fast-model', source: 'settings' });

      expect(
        resolveSubagentTarget({
          spec: { type: 'worker', task: 'x' },
          thread,
          settings,
          providerUsable,
        }),
      ).toEqual({ providerId: 'prv_main', model: 'main-model', source: 'thread' });
    } finally {
      ctx.dispose();
    }
  });

  it('uses the fallback model on the parent provider when the configured provider is gone', () => {
    const ctx = createTestContext();
    try {
      const thread = seed(ctx);
      const settings = ctx.repos.settings.patch({
        subagentModels: {
          ...emptySubagentModels(),
          reviewer: {
            providerId: 'prv_missing',
            model: 'gone-model',
            fallbackModel: 'backup-model',
          },
        },
      });
      const target = resolveSubagentTarget({
        spec: { type: 'reviewer', task: 'x' },
        thread,
        settings,
        providerUsable: (id) => ctx.repos.providers.get(id)?.enabled === true,
      });
      expect(target).toEqual({ providerId: 'prv_main', model: 'backup-model', source: 'fallback' });
    } finally {
      ctx.dispose();
    }
  });
});

describe('subagent service', () => {
  it('spawns read-only children on the parent worktree and a worker on its own', async () => {
    const harness = createHarness();
    try {
      const explorer = await spawn(harness, 'explorer');
      const reviewer = await spawn(harness, 'reviewer');
      const planner = await spawn(harness, 'planner');
      const notetaker = await spawn(harness, 'notetaker');
      for (const childId of [explorer, reviewer, planner, notetaker]) {
        await harness.subagents.awaitChild(childId);
      }
      expect(harness.ports.created.map((request) => request.permissionMode)).toEqual([
        'read-only',
        'read-only',
        'read-only',
        'read-only',
      ]);
      expect(harness.ports.created.every((request) => request.worktree === false)).toBe(true);
      const child = harness.ctx.repos.threads.get('thr_child_1');
      expect(child?.worktreePath).toBe(PARENT_WORKTREE);
      expect(child?.parentThreadId).toBe(PARENT_ID);

      const worker = await spawn(harness, 'worker');
      await harness.subagents.awaitChild(worker);
      const workerThread = harness.ctx.repos.threads.get('thr_child_5');
      expect(workerThread?.permissionMode).toBe('accept-edits');
      expect(workerThread?.worktreePath).toBe('C:/worktrees/thr_child_5');
      expect(workerThread?.branch).toBe('tuffcode/thr_child_5');
    } finally {
      await harness.dispose();
    }
  });

  it('creates a real worktree for a worker', async () => {
    const ctx = createTestContext();
    try {
      const repoPath = join(ctx.env.root, 'repo');
      initRepo(repoPath);
      const { thread } = await createProjectThread(ctx.repos, repoPath);
      const ports = new FakePorts(ctx);
      const subagents = createSubagents({
        repos: ctx.repos,
        bus: createEventBus(),
        runner: fakeRunner(),
        logger: silentLogger(),
        settings: () => ctx.repos.settings.get(),
        ports: { runTurn: (input) => ports.runTurn(input) },
      });
      const { childId } = await subagents.spawn({
        threadId: thread.id,
        spec: { type: 'worker', task: 'Change the readme' },
      });
      const view = await subagents.awaitChild(childId);
      expect(view.status).toBe('done');

      const child = ctx.repos.threads
        .list()
        .find((candidate) => candidate.parentThreadId === thread.id);
      if (child === undefined) throw new Error('worker child thread was not created');
      expect(child.worktreePath).not.toBe(thread.worktreePath);
      expect(child.worktreePath === null ? false : existsSync(child.worktreePath)).toBe(true);
      expect(child.branch).toBe(`tuffcode/${child.id}`);
      await subagents.dispose();
    } finally {
      ctx.dispose();
    }
  });

  it('caps running children and queues the rest', async () => {
    const harness = createHarness({ concurrency: 2 });
    try {
      harness.ports.block = true;
      const childIds: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        childIds.push(await spawn(harness, 'explorer', `Task ${index}`));
      }
      await until(() => harness.ports.created.length === 2);
      expect(harness.ports.created).toHaveLength(2);
      expect(harness.ports.maxActive).toBe(2);

      harness.ports.releaseOne();
      await until(() => harness.ports.created.length === 3);
      expect(harness.ports.maxActive).toBe(2);

      harness.ports.unblockAll();
      await until(() => harness.ports.created.length === 5);
      for (const childId of childIds) await harness.subagents.awaitChild(childId);
      expect(harness.subagents.list(PARENT_ID)).toHaveLength(5);
      expect(harness.ports.maxActive).toBe(2);
      expect(harness.subagents.list(PARENT_ID).every((view) => view.status === 'done')).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('routes child events to the parent thread under the child id', async () => {
    const harness = createHarness();
    try {
      harness.ports.handler = async (input) => {
        input.onEvent({ type: 'text.delta', turnId: 'turn_child', text: 'mapped files' });
        return { status: 'complete', text: 'mapped files' };
      };
      const childId = await spawn(harness, 'explorer');
      const view = await harness.subagents.awaitChild(childId);

      const started = harness.events.filter((event) => event.type === 'subagent.started');
      const routed = harness.events.filter((event) => event.type === 'subagent.event');
      const finished = harness.events.filter((event) => event.type === 'subagent.finished');
      expect(started).toHaveLength(1);
      expect(started[0]?.threadId).toBe(PARENT_ID);
      expect(started[0]?.payload).toMatchObject({ childId, type: 'explorer', model: 'main-model' });
      expect(Object.keys(started[0]?.payload ?? {}).toSorted()).toEqual([
        'childId',
        'model',
        'threadId',
        'type',
      ]);
      expect(routed).toHaveLength(1);
      expect(routed[0]?.payload).toMatchObject({ childId, threadId: PARENT_ID });
      expect(finished).toHaveLength(1);
      expect(finished[0]?.payload).toMatchObject({
        childId,
        status: 'done',
        summary: 'mapped files',
      });
      expect(view.summary).toBe('mapped files');
    } finally {
      await harness.dispose();
    }
  });

  it('cancels a running child and interrupts its session', async () => {
    const harness = createHarness();
    try {
      harness.ports.block = true;
      const childId = await spawn(harness, 'worker');
      await until(() => harness.ports.turns.length === 1);
      await harness.subagents.cancel(childId);
      const view = await harness.subagents.awaitChild(childId);
      expect(view.status).toBe('cancelled');
      expect(harness.runner.interrupts).toEqual(['thr_child_1']);
    } finally {
      await harness.dispose();
    }
  });

  it('keeps a child cancelled when the cancel lands during worktree creation', async () => {
    const harness = createHarness();
    try {
      harness.ports.blockCreate = true;
      const childId = await spawn(harness, 'worker');
      await until(() => harness.ports.created.length === 1);
      await harness.subagents.cancel(childId);
      harness.ports.releaseCreate();
      await until(() => harness.ctx.repos.threads.get('thr_child_1') !== undefined);
      const view = await harness.subagents.awaitChild(childId);
      expect(view.status).toBe('cancelled');
      expect(harness.ports.turns).toHaveLength(0);
      expect(harness.ctx.repos.subagents.get(childId)?.status).toBe('cancelled');
    } finally {
      await harness.dispose();
    }
  });

  it('cancels a queued child without starting it', async () => {
    const harness = createHarness({ concurrency: 1 });
    try {
      harness.ports.block = true;
      const first = await spawn(harness, 'explorer');
      const second = await spawn(harness, 'explorer');
      await harness.subagents.cancel(second);
      expect((await harness.subagents.awaitChild(second)).status).toBe('cancelled');
      harness.ports.unblockAll();
      expect((await harness.subagents.awaitChild(first)).status).toBe('done');
      expect(harness.ports.created).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });

  it('fails a child that exceeds its token budget', async () => {
    const harness = createHarness();
    try {
      harness.ports.handler = async (input) => {
        input.onEvent({ type: 'text.delta', turnId: 'turn_child', text: 'x'.repeat(400) });
        return { status: 'complete', text: 'x'.repeat(400) };
      };
      const { childId } = await harness.subagents.spawn({
        threadId: PARENT_ID,
        spec: { type: 'explorer', task: 'Read everything', budgetTokens: 10 },
      });
      const view = await harness.subagents.awaitChild(childId);
      expect(view.status).toBe('failed');
      expect(view.summary).toContain('Token budget of 10 exceeded');
    } finally {
      await harness.dispose();
    }
  });

  it('stores notetaker facts in the brain and links them about the project entry', async () => {
    const harness = createHarness();
    try {
      const anchor = harness.ctx.repos.brain.upsert({
        kind: 'project',
        scope: 'project',
        projectId: 'prj_1',
        text: 'Demo project brain',
        importance: 1,
      });
      harness.ports.handler = () =>
        Promise.resolve({
          status: 'complete',
          text: JSON.stringify({
            facts: [
              { text: 'Tests run with vitest run', tags: 'tests, vitest', importance: 0.5 },
              { text: 'CI uses pnpm', tags: 'ci', importance: 0.4 },
            ],
          }),
        });
      const childId = await spawn(harness, 'notetaker');
      const view = await harness.subagents.awaitChild(childId);
      expect(view.summary).toContain('Recorded 2 of 2 facts');
      const entries = harness.ctx.repos.brain.list({ projectId: 'prj_1' });
      expect(entries.map((entry) => entry.text)).toEqual(
        expect.arrayContaining(['Tests run with vitest run', 'CI uses pnpm']),
      );

      const edges = harness.ctx.repos.brain.listEdges();
      expect(edges).toHaveLength(2);
      expect(edges.every((edge) => edge.to === anchor.id && edge.relation === 'about')).toBe(true);
      const factIds = entries
        .filter((entry) => entry.id !== anchor.id)
        .map((entry) => entry.id)
        .toSorted();
      expect(edges.map((edge) => edge.from).toSorted()).toEqual(factIds);
      expect(new Set(edges.map((edge) => `${edge.from}|${edge.to}|${edge.relation}`)).size).toBe(2);
    } finally {
      await harness.dispose();
    }
  });

  it('stores notetaker facts without edges when the project has no brain entry', async () => {
    const harness = createHarness();
    try {
      harness.ports.handler = () =>
        Promise.resolve({
          status: 'complete',
          text: '{"facts":[{"text":"Tests run with vitest run","tags":"tests","importance":0.5}]}',
        });
      const childId = await spawn(harness, 'notetaker');
      await harness.subagents.awaitChild(childId);
      expect(harness.ctx.repos.brain.list({ projectId: 'prj_1' })).toHaveLength(1);
      expect(harness.ctx.repos.brain.listEdges()).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it('lists every child across threads without internal columns', async () => {
    const harness = createHarness();
    try {
      const now = new Date().toISOString();
      harness.ctx.repos.threads.create({
        id: 'thr_parent_2',
        projectId: 'prj_1',
        parentThreadId: null,
        title: 'Second parent',
        providerId: 'prv_main',
        modelId: 'main-model',
        executionMode: 'work',
        permissionMode: 'ask',
        status: 'idle',
        worktreePath: 'C:/worktrees/second',
        branch: 'tuffcode/thr_parent_2',
        baseBranch: 'main',
        createdAt: now,
        updatedAt: now,
      });
      const first = await spawn(harness, 'explorer');
      const second = await spawn(harness, 'notetaker');
      const other = await harness.subagents
        .spawn({ threadId: 'thr_parent_2', spec: { type: 'explorer', task: 'Other work' } })
        .then((result) => result.childId);
      for (const childId of [first, second, other]) {
        await harness.subagents.awaitChild(childId);
      }

      expect(harness.subagents.list(PARENT_ID)).toHaveLength(2);
      const views = harness.subagents.listAll();
      expect(views.map((view) => view.childId)).toEqual([first, second, other]);
      expect(views.map((view) => view.childThreadId)).toEqual([
        'thr_child_1',
        'thr_child_2',
        'thr_child_3',
      ]);
      expect(views.some((view) => 'budgetTokens' in view)).toBe(false);

      const handlers = createSubagentHandlers({ subagents: harness.subagents });
      const listAll = handlers.get('subagents.listAll');
      if (listAll === undefined) throw new Error('subagents.listAll is not registered');
      expect(await listAll({})).toEqual(views);
    } finally {
      await harness.dispose();
    }
  });

  it('persists children so a restart can list them and fail the unfinished', async () => {
    const harness = createHarness({ concurrency: 1 });
    try {
      harness.ports.block = true;
      const running = await spawn(harness, 'explorer');
      const queued = await spawn(harness, 'planner');
      await until(() => harness.ports.turns.length === 1);
      expect(harness.subagents.list(PARENT_ID)).toHaveLength(2);

      const dbFile = join(harness.ctx.env.root, 'tuffcode.db');
      const second = openDb(dbFile);
      try {
        const repos = createRepos(second);
        const restarted = createSubagents({
          repos,
          bus: createEventBus(),
          runner: fakeRunner(),
          logger: silentLogger(),
          settings: () => repos.settings.get(),
        });
        const views = restarted.list(PARENT_ID);
        expect(views.map((view) => view.childId)).toEqual([running, queued]);
        expect(views.map((view) => view.status)).toEqual(['running', 'queued']);

        expect(restarted.recoverOrphaned()).toBe(2);
        const recovered = restarted.list(PARENT_ID);
        expect(recovered.map((view) => view.status)).toEqual(['failed', 'failed']);
        expect(recovered[0]?.summary).toContain('server restarted');
      } finally {
        second.close();
      }
      harness.ports.unblockAll();
    } finally {
      await harness.dispose();
    }
  });

  it('resolves the parent thread from the turn cwd for the harness tool', async () => {
    const harness = createHarness();
    try {
      const spawned = await harness.subagents.spawnFromTool({
        cwd: PARENT_WORKTREE,
        type: 'explorer',
        task: 'Map the parser',
      });
      expect(['queued', 'running']).toContain(spawned.status);
      await harness.subagents.awaitChild(spawned.childId);
      expect(harness.subagents.list(PARENT_ID)).toHaveLength(1);

      await expect(
        harness.subagents.spawnFromTool({ cwd: 'C:/nowhere', type: 'explorer', task: 'x' }),
      ).rejects.toThrow(/no thread owns this worktree/);

      const parent = harness.ctx.repos.threads.get(PARENT_ID);
      if (parent !== undefined) {
        harness.ctx.repos.threads.update(PARENT_ID, {
          permissionMode: 'read-only',
          updatedAt: new Date().toISOString(),
        });
      }
      await expect(
        harness.subagents.spawnFromTool({ cwd: PARENT_WORKTREE, type: 'explorer', task: 'x' }),
      ).rejects.toThrow(/read-only/);
    } finally {
      await harness.dispose();
    }
  });
});

describe('subagent control, telemetry and mailbox', () => {
  it('counts tool calls and tokens and posts the final answer to the parent', async () => {
    const harness = createHarness();
    try {
      harness.ports.handler = async (input) => {
        input.onEvent({ type: 'tool.started', turnId: 't', toolCallId: 'c1', name: 'bash', input: { command: 'pnpm test' } });
        input.onEvent({ type: 'tool.started', turnId: 't', toolCallId: 'c2', name: 'read', input: { path: 'a.ts' } });
        input.onEvent({ type: 'tool.started', turnId: 't', toolCallId: 'c3', name: 'grep', input: { pattern: 'todo' } });
        input.onEvent({ type: 'usage', turnId: 't', inputTokens: 300, outputTokens: 40 });
        input.onEvent({ type: 'usage', turnId: 't', inputTokens: 200, outputTokens: 10 });
        return { status: 'complete', text: 'found two callers' };
      };
      const childId = await spawn(harness, 'explorer', 'map the callers');
      const view = await harness.subagents.awaitChild(childId);
      expect(view.status).toBe('done');
      const stored = harness.subagents.get(childId);
      expect(stored).toMatchObject({ toolCount: 3, inputTokens: 500, outputTokens: 50, activity: 'grep: todo' });
      expect(stored.unread).toBe(1);
      expect(harness.events.some((event) => event.type === 'subagent.telemetry')).toBe(true);
      const inbox = await harness.subagents.control({ action: 'inbox', cwd: PARENT_WORKTREE, threadId: PARENT_ID });
      expect(inbox).toContain('found two callers');
      expect(harness.subagents.get(childId).unread).toBe(0);
      const status = await harness.subagents.control({ action: 'status', cwd: PARENT_WORKTREE, threadId: PARENT_ID });
      expect(status).toContain(`${childId} explorer [done]`);
      expect(status).toContain('3 tools, 500 in / 50 out tokens');
    } finally {
      await harness.dispose();
    }
  });

  it('delivers a message to a running child after its current turn', async () => {
    const harness = createHarness();
    try {
      harness.ports.block = true;
      const childId = await spawn(harness, 'explorer', 'map the runner');
      await until(() => harness.ports.turns.length === 1);
      const sent = await harness.subagents.message(childId, 'also read the tests');
      expect(sent).toEqual({ delivered: 'queued' });
      harness.ports.unblockAll();
      const view = await harness.subagents.awaitChild(childId);
      expect(view.status).toBe('done');
      expect(harness.ports.turns).toHaveLength(2);
      expect(harness.ports.turns[1]?.text).toContain('also read the tests');
      const directions = harness.subagents.messages(childId).map((message) => message.direction);
      expect(directions).toEqual(['to-child', 'to-parent', 'to-parent']);
    } finally {
      await harness.dispose();
    }
  });

  it('reopens a settled child for a follow-up and refuses one to a stopped child', async () => {
    const harness = createHarness();
    try {
      const childId = await spawn(harness, 'worker', 'add the flag');
      await harness.subagents.awaitChild(childId);
      harness.ports.handler = () => Promise.resolve({ status: 'complete', text: 'tests added too' });
      const sent = await harness.subagents.message(childId, 'now add tests');
      expect(sent).toEqual({ delivered: 'started' });
      await until(() => harness.subagents.get(childId).summary === 'tests added too');
      expect(harness.subagents.get(childId).status).toBe('done');

      harness.ports.block = true;
      const other = await spawn(harness, 'explorer', 'map it');
      await until(() => harness.ports.turns.length === 3);
      const stopped = await harness.subagents.control({
        action: 'stop',
        cwd: PARENT_WORKTREE,
        threadId: PARENT_ID,
        id: other,
      });
      expect(stopped).toBe(`${other} stopped.`);
      expect(harness.subagents.get(other).status).toBe('cancelled');
      await expect(harness.subagents.message(other, 'continue')).rejects.toThrow(/stopped/);
    } finally {
      harness.ports.unblockAll();
      await harness.dispose();
    }
  });

  it('waits for children and reports the ones still running after the timeout', async () => {
    const harness = createHarness();
    try {
      harness.ports.block = true;
      const childId = await spawn(harness, 'explorer', 'slow work');
      await until(() => harness.ports.turns.length === 1);
      const pending = await harness.subagents.control({
        action: 'wait',
        cwd: PARENT_WORKTREE,
        threadId: PARENT_ID,
        timeoutSeconds: 1,
      });
      expect(pending).toContain(`Still running after 1s: ${childId}`);
      setTimeout(() => harness.ports.unblockAll(), 20);
      const settled = await harness.subagents.control({
        action: 'wait',
        cwd: PARENT_WORKTREE,
        threadId: PARENT_ID,
        id: childId,
        timeoutSeconds: 30,
      });
      expect(settled).toContain('[done]');
      expect(settled).toContain('child summary');
    } finally {
      harness.ports.unblockAll();
      await harness.dispose();
    }
  });

  it('lets a child report to its parent but not control siblings or spawn', async () => {
    const harness = createHarness();
    try {
      harness.ports.block = true;
      const childId = await spawn(harness, 'explorer', 'look around');
      await until(() => harness.ports.turns.length === 1);
      const childThread = harness.ports.turns[0]?.threadId ?? '';
      const reported = await harness.subagents.control({
        action: 'report',
        cwd: PARENT_WORKTREE,
        threadId: childThread,
        text: 'halfway there',
      });
      expect(reported).toBe('Report delivered to the parent.');
      expect(harness.subagents.get(childId).unread).toBe(1);
      await expect(
        harness.subagents.control({ action: 'stop', cwd: PARENT_WORKTREE, threadId: childThread, id: childId }),
      ).rejects.toThrow(/cannot stop/);
      await expect(
        harness.subagents.spawnFromTool({ cwd: PARENT_WORKTREE, threadId: childThread, type: 'explorer', task: 'x' }),
      ).rejects.toThrow(/cannot spawn/);
    } finally {
      harness.ports.unblockAll();
      await harness.dispose();
    }
  });
});
