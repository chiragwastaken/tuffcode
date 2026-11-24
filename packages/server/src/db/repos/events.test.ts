import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test-support.js';

const THREAD_ID = 'thr_events';
const NOW = '2026-01-01T00:00:00.000Z';

describe('events repo', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.projects.add({
      id: 'prj_events',
      name: 'events',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: NOW,
    });
    ctx.repos.threads.create({
      id: THREAD_ID,
      projectId: 'prj_events',
      parentThreadId: null,
      title: 'Events',
      providerId: 'prv_test',
      modelId: 'model',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('appends 100 events and replays from seq 50', () => {
    for (let index = 1; index <= 100; index += 1) {
      const seq = ctx.repos.events.append(THREAD_ID, 'thread.event', {
        type: 'text.delta',
        turnId: 'turn_1',
        text: `chunk ${index}`,
      });
      expect(seq).toBe(index);
    }

    expect(ctx.repos.threads.get(THREAD_ID)?.lastSeq).toBe(100);

    const page = ctx.repos.events.since(THREAD_ID, 50, 100);
    expect(page).toHaveLength(50);
    expect(page[0]?.seq).toBe(51);
    expect(page[49]?.seq).toBe(100);
    expect(page[0]?.payload).toEqual({
      type: 'text.delta',
      turnId: 'turn_1',
      text: 'chunk 51',
    });

    const limited = ctx.repos.events.since(THREAD_ID, 50, 10);
    expect(limited.map((event) => event.seq)).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  });

  it('keeps seq monotonic per thread and rejects unknown threads', () => {
    ctx.repos.events.append(THREAD_ID, 'thread.event', {
      type: 'turn.started',
      turnId: 'turn_1',
    });
    ctx.repos.events.append(THREAD_ID, 'thread.event', {
      type: 'turn.finished',
      turnId: 'turn_1',
      reason: 'complete',
    });
    expect(ctx.repos.events.count(THREAD_ID)).toBe(2);
    expect(ctx.repos.threads.get(THREAD_ID)?.lastSeq).toBe(2);
    expect(() =>
      ctx.repos.events.append('thr_missing', 'thread.event', { type: 'error', message: 'x' }),
    ).toThrow('thread not found');
  });
});
