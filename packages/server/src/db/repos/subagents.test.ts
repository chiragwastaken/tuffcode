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
      createdAt: CREATED,
      updatedAt: CREATED,
    });
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
