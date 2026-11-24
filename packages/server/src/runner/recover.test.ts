import type { ServerEvent } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../events.js';
import { createSecretBridge } from '../secrets/bridge.js';
import { createTestContext, silentLogger, type TestContext } from '../test-support.js';
import { createRunner } from './runner.js';

const ISO = '2026-11-24T10:00:00.000Z';

describe('orphan recovery', () => {
  let ctx: TestContext;

  function addThread(id: string, status: 'idle' | 'running' | 'needs-approval'): void {
    ctx.repos.threads.create({
      id,
      projectId: 'prj_a',
      parentThreadId: null,
      title: id,
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status,
      worktreePath: ctx.env.root,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
  }

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.providers.upsert({ id: 'prv_test', kind: 'claude', label: 'Test', config: {} });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('fails running and needs-approval turns without creating an adapter', () => {
    const bus = createEventBus();
    const events: ServerEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const createAdapter = vi.fn(async () => {
      throw new Error('recovery must not create adapters');
    });
    const runner = createRunner({
      repos: ctx.repos,
      bus,
      logger: silentLogger(),
      secrets: createSecretBridge(undefined),
      settings: () => ctx.repos.settings.get(),
      createAdapter,
    });

    addThread('thr_running', 'running');
    addThread('thr_approval', 'needs-approval');
    addThread('thr_done', 'idle');

    ctx.repos.turns.create({
      id: 'turn_running',
      threadId: 'thr_running',
      status: 'running',
      injectedIds: [],
      createdAt: ISO,
    });
    ctx.repos.turns.create({
      id: 'turn_approval',
      threadId: 'thr_approval',
      status: 'needs-approval',
      injectedIds: [],
      createdAt: ISO,
    });
    ctx.repos.turns.create({
      id: 'turn_done',
      threadId: 'thr_done',
      status: 'complete',
      injectedIds: [],
      createdAt: ISO,
    });
    ctx.repos.approvals.create({
      id: 'apv_1',
      threadId: 'thr_approval',
      toolCallId: 'call_1',
      toolName: 'bash',
      input: {},
      createdAt: ISO,
    });

    runner.recoverOrphanedRuns();

    expect(createAdapter).not.toHaveBeenCalled();

    for (const turnId of ['turn_running', 'turn_approval']) {
      expect(ctx.repos.turns.get(turnId)).toMatchObject({ status: 'failed' });
      expect(ctx.repos.turns.get(turnId)?.finishedAt).not.toBeNull();
    }
    expect(ctx.repos.turns.get('turn_done')).toMatchObject({ status: 'complete', finishedAt: null });
    expect(ctx.repos.threads.get('thr_running')?.status).toBe('failed');
    expect(ctx.repos.threads.get('thr_approval')?.status).toBe('failed');
    expect(ctx.repos.threads.get('thr_done')?.status).toBe('idle');
    expect(ctx.repos.approvals.get('apv_1')).toMatchObject({ decision: 'deny' });
    expect(ctx.repos.approvals.get('apv_1')?.resolvedAt).not.toBeNull();

    const running = ctx.repos.events.since('thr_running', 0, 10);
    expect(running.map((row) => row.type)).toEqual(['error', 'turn.finished']);
    expect(running.map((row) => row.seq)).toEqual([1, 2]);
    expect(running[0]?.payload).toMatchObject({
      type: 'error',
      message: 'server restarted before the turn finished',
      retryable: false,
    });
    expect(running[1]?.payload).toEqual({
      type: 'turn.finished',
      turnId: 'turn_running',
      reason: 'error',
    });

    const approvalThread = ctx.repos.events.since('thr_approval', 0, 10);
    expect(approvalThread.map((row) => row.type)).toEqual(['error', 'turn.finished']);
    expect(approvalThread[1]?.payload).toEqual({
      type: 'turn.finished',
      turnId: 'turn_approval',
      reason: 'error',
    });

    expect(ctx.repos.events.since('thr_done', 0, 10)).toEqual([]);

    const threadEvents = events.filter(
      (event): event is Extract<ServerEvent, { type: 'thread.event' }> =>
        event.type === 'thread.event',
    );
    expect(threadEvents.map((event) => event.threadId)).toEqual([
      'thr_running',
      'thr_running',
      'thr_approval',
      'thr_approval',
    ]);
    expect(events.some((event) => event.type === 'thread.updated')).toBe(true);
  });

  it('is idempotent: a second recovery finds nothing active', () => {
    const bus = createEventBus();
    const runner = createRunner({
      repos: ctx.repos,
      bus,
      logger: silentLogger(),
      secrets: createSecretBridge(undefined),
      settings: () => ctx.repos.settings.get(),
      createAdapter: async () => {
        throw new Error('unreachable');
      },
    });
    addThread('thr_running', 'running');
    ctx.repos.turns.create({
      id: 'turn_running',
      threadId: 'thr_running',
      status: 'running',
      injectedIds: [],
      createdAt: ISO,
    });

    runner.recoverOrphanedRuns();
    runner.recoverOrphanedRuns();

    expect(ctx.repos.events.since('thr_running', 0, 10)).toHaveLength(2);
  });
});
