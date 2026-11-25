import type { ServerEvent } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../events.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { TODO_LIMITS, applyTodoOp, createTodoService, formatTodoSummary, type TodoService } from './service.js';

const ISO = '2026-11-25T10:00:00.000Z';

describe('todo ops', () => {
  it('builds a flat list in the default phase and a phased list', () => {
    expect(applyTodoOp([], { op: 'init', items: ['a', 'b'] })).toEqual([
      {
        name: 'Tasks',
        tasks: [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
        ],
      },
    ]);
    const phased = applyTodoOp([], {
      op: 'init',
      list: [
        { phase: 'Build', items: ['schema'] },
        { phase: 'Ship', items: ['release'] },
      ],
    });
    expect(phased.map((phase) => phase.name)).toEqual(['Build', 'Ship']);
    expect(() =>
      applyTodoOp([], { op: 'init', list: [{ phase: 'A', items: ['x'] }, { phase: 'A', items: ['y'] }] }),
    ).toThrow(/duplicate phase/);
  });

  it('keeps exactly one task in progress', () => {
    let phases = applyTodoOp([], { op: 'init', items: ['a', 'b', 'c'] });
    phases = applyTodoOp(phases, { op: 'start', task: 'a' });
    phases = applyTodoOp(phases, { op: 'start', task: 'b' });
    expect(phases[0]?.tasks.map((task) => task.status)).toEqual(['pending', 'in_progress', 'pending']);
  });

  it('closes a task, a phase, or everything, and removes the same way', () => {
    const base = applyTodoOp([], {
      op: 'init',
      list: [
        { phase: 'A', items: ['a1', 'a2'] },
        { phase: 'B', items: ['b1'] },
      ],
    });
    expect(applyTodoOp(base, { op: 'done', task: 'a1' })[0]?.tasks[0]?.status).toBe('completed');
    expect(applyTodoOp(base, { op: 'drop', phase: 'B' })[1]?.tasks[0]?.status).toBe('abandoned');
    expect(
      applyTodoOp(base, { op: 'done' }).flatMap((phase) => phase.tasks.map((task) => task.status)),
    ).toEqual(['completed', 'completed', 'completed']);
    expect(applyTodoOp(base, { op: 'rm', task: 'a2' })[0]?.tasks).toHaveLength(1);
    expect(applyTodoOp(base, { op: 'rm', phase: 'A' })[0]?.tasks).toEqual([]);
    expect(applyTodoOp(base, { op: 'rm' })).toEqual([]);
  });

  it('appends to the in-progress phase, then the first pending one, or creates a named phase', () => {
    let phases = applyTodoOp([], {
      op: 'init',
      list: [
        { phase: 'A', items: ['a1'] },
        { phase: 'B', items: ['b1'] },
      ],
    });
    phases = applyTodoOp(phases, { op: 'start', task: 'b1' });
    phases = applyTodoOp(phases, { op: 'append', items: ['b2'] });
    expect(phases[1]?.tasks.map((task) => task.content)).toEqual(['b1', 'b2']);
    phases = applyTodoOp(phases, { op: 'append', phase: 'C', items: ['c1'] });
    expect(phases.map((phase) => phase.name)).toEqual(['A', 'B', 'C']);
    expect(applyTodoOp([], { op: 'append', items: ['x'] })[0]?.name).toBe('Tasks');
  });

  it('refuses unknown tasks and oversized input', () => {
    const base = applyTodoOp([], { op: 'init', items: ['a'] });
    expect(() => applyTodoOp(base, { op: 'start', task: 'missing' })).toThrow(/no task named/);
    expect(() =>
      applyTodoOp([], { op: 'init', items: Array.from({ length: TODO_LIMITS.tasksPerPhase + 1 }, (_, i) => `t${i}`) }),
    ).toThrow(/at most/);
    expect(() => applyTodoOp([], { op: 'init', items: ['x'.repeat(501)] })).toThrow(/500/);
    expect(() => applyTodoOp([], { op: 'init', items: ['  '] })).toThrow(/empty/);
  });

  it('summarizes remaining work and the current phase', () => {
    let phases = applyTodoOp([], { op: 'init', items: ['a', 'b'] });
    phases = applyTodoOp(phases, { op: 'done', task: 'a' });
    phases = applyTodoOp(phases, { op: 'start', task: 'b' });
    expect(formatTodoSummary(phases)).toBe(
      ['1 of 2 tasks remaining.', 'Current phase: Tasks 1/2', 'Tasks', '  [x] a', '  [>] b'].join('\n'),
    );
    expect(formatTodoSummary([])).toBe('Todo list cleared.');
    expect(formatTodoSummary([], true)).toBe('Todo list is empty.');
  });
});

describe('todo service', () => {
  let ctx: TestContext;
  let service: TodoService;
  const events: ServerEvent[] = [];

  beforeEach(() => {
    ctx = createTestContext();
    const bus = createEventBus();
    events.length = 0;
    bus.subscribe((event) => events.push(event));
    service = createTodoService({ repos: ctx.repos, bus, now: () => ISO });
    ctx.repos.projects.add({ id: 'prj', name: 'p', path: ctx.env.root, defaultBranch: 'main', createdAt: ISO });
    ctx.repos.threads.create({
      id: 'thr',
      projectId: 'prj',
      parentThreadId: null,
      title: 't',
      providerId: 'prv',
      modelId: 'm',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
  });
  afterEach(() => ctx.dispose());

  it('persists tool calls, emits updates, and leaves state alone on errors', () => {
    expect(service.applyToolCall('thr', { op: 'init', items: '["write tests","wire tool"]' })).toContain(
      '2 of 2 tasks remaining.',
    );
    expect(events.filter((event) => event.type === 'todo.updated')).toHaveLength(1);
    expect(service.applyToolCall('thr', { op: 'start', task: 'nope' })).toMatch(/^Errors: no task named/);
    expect(service.applyToolCall('thr', { op: 'view' })).toContain('[ ] write tests');
    expect(events.filter((event) => event.type === 'todo.updated')).toHaveLength(1);
    expect(service.applyToolCall('thr', { op: 'teleport' })).toMatch(/^Invalid todo arguments/);
    expect(service.applyToolCall('thr', { items: 'not json' })).toMatch(/^Invalid todo arguments/);
    expect(service.get('thr')).toMatchObject({ threadId: 'thr', updatedAt: ISO });
    expect(service.get('thr').phases[0]?.tasks).toHaveLength(2);
  });

  it('infers init from a lone list payload and accepts real arrays', () => {
    service.applyToolCall('thr', { list: [{ phase: 'Build', items: ['a'] }] });
    expect(service.get('thr').phases[0]?.name).toBe('Build');
  });
});
