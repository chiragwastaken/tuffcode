import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test-support.js';
import type { SubagentRecord } from './subagents.js';
import { toSubagentView } from './subagents.js';

const CREATED = '2026-01-01T00:00:00.000Z';
const UPDATED = '2026-01-01T00:00:05.000Z';
const PARENT_ID = 'thr_parent';

function requireRecord(record: SubagentRecord | undefined): SubagentRecord {
  if (record === undefined) throw new Error('subagent row is missing');
  return record;
}

describe('subagents repo', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.projects.add({
      id: 'prj_1',
      name: 'Demo',
      path: 'C:/demo',
      defaultBranch: 'main',
      createdAt: CREATED,
    });
    ctx.repos.threads.create({
      id: PARENT_ID,
      projectId: 'prj_1',
      parentThreadId: null,
      title: 'Parent thread',
      providerId: 'prv_1',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
  });

  afterEach(() => {
    ctx.dispose();
  });

  function create(childId = 'sub_1', status: 'queued' | 'running' = 'queued'): SubagentRecord {
    return ctx.repos.subagents.create({
      childId,
      threadId: PARENT_ID,
      type: 'explorer',
      providerId: 'prv_1',
      model: 'model-x',
      status,
      task: 'map the project',
      createdAt: CREATED,
    });
  }

  it('reports a null child thread until the child starts running', () => {
    const created = create();

    expect(created.childThreadId).toBeNull();
    expect(toSubagentView(created)).toEqual({
      childId: 'sub_1',
      threadId: PARENT_ID,
      childThreadId: null,
      type: 'explorer',
      model: 'model-x',
      providerId: 'prv_1',
      status: 'queued',
      task: 'map the project',
      startedAt: null,
      finishedAt: null,
      unread: 0,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
  });

  it('starts telemetry at zero when the child runs and records later counters', () => {
    create();
    expect(ctx.repos.subagents.get('sub_1')?.toolCount).toBeUndefined();
    const running = requireRecord(ctx.repos.subagents.setRunning('sub_1', 'thr_child_1', UPDATED));
    expect(running.toolCount).toBe(0);
    expect(running.startedAt).toBe(UPDATED);
    ctx.repos.subagents.recordTelemetry('sub_1', {
      toolCount: 4,
      inputTokens: 900,
      outputTokens: 120,
      activity: 'bash: pnpm test',
    });
    const view = toSubagentView(requireRecord(ctx.repos.subagents.get('sub_1')));
    expect(view).toMatchObject({
      toolCount: 4,
      inputTokens: 900,
      outputTokens: 120,
      activity: 'bash: pnpm test',
    });
    const done = requireRecord(
      ctx.repos.subagents.finish('sub_1', { status: 'done', summary: 'ok', updatedAt: UPDATED }),
    );
    expect(done.finishedAt).toBe(UPDATED);
    const reopened = requireRecord(ctx.repos.subagents.reopen('sub_1', UPDATED));
    expect(reopened.status).toBe('running');
    expect(reopened.finishedAt).toBeNull();
    expect(reopened.toolCount).toBe(4);
  });

  it('keeps a mailbox per child and counts unread reports', () => {
    create();
    ctx.repos.subagents.addMessage({
      id: 'sm_1',
      childId: 'sub_1',
      direction: 'to-child',
      text: 'also read the tests',
      createdAt: CREATED,
    });
    ctx.repos.subagents.addMessage({
      id: 'sm_2',
      childId: 'sub_1',
      direction: 'to-parent',
      text: 'found the bug',
      createdAt: UPDATED,
    });
    expect(ctx.repos.subagents.listMessages('sub_1').map((m) => m.id)).toEqual(['sm_1', 'sm_2']);
    expect(ctx.repos.subagents.get('sub_1')?.unread).toBe(1);
    expect(ctx.repos.subagents.unreadMessages('sub_1').map((m) => m.text)).toEqual([
      'found the bug',
    ]);
    expect(ctx.repos.subagents.markRead('sub_1', UPDATED)).toBe(1);
    expect(ctx.repos.subagents.get('sub_1')?.unread).toBe(0);
    expect(ctx.repos.subagents.unreadMessages('sub_1')).toEqual([]);
  });

  it('carries the child thread id through setRunning into the view', () => {
    create();

    const running = requireRecord(ctx.repos.subagents.setRunning('sub_1', 'thr_child_1', UPDATED));
    expect(running.childThreadId).toBe('thr_child_1');

    const view = toSubagentView(running);
    expect(view.childThreadId).toBe('thr_child_1');
    expect('budgetTokens' in view).toBe(false);
  });

  it('maps the child thread id in listByThread and listAll', () => {
    create('sub_1');
    create('sub_2');
    ctx.repos.subagents.setRunning('sub_2', 'thr_child_2', UPDATED);

    expect(ctx.repos.subagents.listByThread(PARENT_ID).map(toSubagentView)).toMatchObject([
      { childId: 'sub_1', childThreadId: null },
      { childId: 'sub_2', childThreadId: 'thr_child_2' },
    ]);
    expect(ctx.repos.subagents.listAll().map(toSubagentView)).toMatchObject([
      { childId: 'sub_1', childThreadId: null },
      { childId: 'sub_2', childThreadId: 'thr_child_2' },
    ]);
  });
});
