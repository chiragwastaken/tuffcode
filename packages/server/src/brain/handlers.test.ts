import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { createBrainHandlers, type BrainHandlers } from './handlers.js';
import { recordInjection, selectBrain } from './selector.js';
import { createBrainStore, type BrainStore } from './store.js';

const ISO = '2026-11-24T10:00:00.000Z';

describe('brain RPC handlers', () => {
  let ctx: TestContext;
  let store: BrainStore;
  let handlers: BrainHandlers;

  beforeEach(() => {
    ctx = createTestContext();
    store = createBrainStore(ctx.repos.brain);
    handlers = createBrainHandlers({ repos: ctx.repos });
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: 'C:/tmp/alpha',
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.projects.add({
      id: 'prj_b',
      name: 'beta',
      path: 'C:/tmp/beta',
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'alpha thread',
      providerId: 'prv_x',
      modelId: 'model-x',
      executionMode: 'plan',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('lists, upserts and deletes entries', () => {
    const created = handlers['brain.upsert']({
      kind: 'preference',
      scope: 'global',
      text: 'dark theme by default',
    });
    expect(created.id).toMatch(/^brn_/);
    expect(handlers['brain.list']({})).toEqual([created]);

    expect(handlers['brain.delete']({ id: created.id })).toEqual({});
    expect(store.get(created.id)).toBeUndefined();
    expect(handlers['brain.list']({})).toEqual([]);
    expect(() => handlers['brain.delete']({ id: 'brn_missing' })).toThrow('brain entry not found');
  });

  it('deactivates and re-enables through upsert, and only the inspector sees inactive rows', () => {
    const created = handlers['brain.upsert']({
      kind: 'preference',
      scope: 'global',
      text: 'dark theme by default',
      importance: 0.8,
    });

    const off = handlers['brain.upsert']({
      id: created.id,
      kind: created.kind,
      scope: created.scope,
      text: created.text,
      importance: created.importance,
      active: false,
    });
    expect(off.active).toBe(false);
    expect(handlers['brain.list']({})).toEqual([]);
    expect(handlers['brain.list']({ includeInactive: true })).toEqual([off]);

    const on = handlers['brain.upsert']({
      id: created.id,
      kind: off.kind,
      scope: off.scope,
      text: off.text,
      importance: off.importance,
      active: true,
    });
    expect(on.active).toBe(true);
    expect(handlers['brain.list']({})).toEqual([on]);
  });

  it('keeps a project scope when an upsert omits projectId', () => {
    const entry = handlers['brain.upsert']({
      kind: 'project',
      scope: 'project',
      projectId: 'prj_a',
      text: 'Electron plus React',
    });

    const toggled = handlers['brain.upsert']({
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      text: entry.text,
      importance: entry.importance,
      active: false,
    });
    expect(toggled.projectId).toBe('prj_a');
    expect(toggled.active).toBe(false);

    const moved = handlers['brain.upsert']({
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      projectId: null,
      text: entry.text,
      importance: entry.importance,
    });
    expect(moved.projectId).toBeNull();
  });

  it('keeps the source quote when an upsert omits it', () => {
    const learned = store.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'never use npm',
      sourceQuote: 'the user said: never use npm',
    });

    const toggled = handlers['brain.upsert']({
      id: learned.id,
      kind: learned.kind,
      scope: learned.scope,
      text: learned.text,
      importance: learned.importance,
      active: false,
    });

    expect(toggled.active).toBe(false);
    expect(toggled.sourceQuote).toBe('the user said: never use npm');
  });

  it('previews exactly what the turn runner would inject', () => {
    store.upsert({ kind: 'rule', scope: 'global', text: 'never use npm', appliesTo: 'all' });
    store.upsert({ kind: 'rule', scope: 'global', text: 'plan first', appliesTo: 'plan' });
    store.upsert({ kind: 'preference', scope: 'global', text: 'dark theme', importance: 0.8 });
    store.upsert({ kind: 'memory', scope: 'global', text: 'sharedtoken memory' });
    store.upsert({
      kind: 'project',
      scope: 'project',
      projectId: 'prj_a',
      text: 'Electron plus React',
    });

    const preview = handlers['brain.preview']({
      projectId: 'prj_a',
      threadId: 'thr_a',
      message: 'sharedtoken',
    });
    const expected = selectBrain(store, {
      projectId: 'prj_a',
      message: 'sharedtoken',
      mode: 'plan',
    });

    expect(preview).toEqual(expected.slice);
    expect(preview.always.map((entry) => entry.text)).toContain('plan first');
    expect(preview.retrieved.map((entry) => entry.text)).toContain('sharedtoken memory');
  });

  it('does not bump usage on preview, only on a recorded injection', () => {
    const memory = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken memory',
    });

    const preview = handlers['brain.preview']({ projectId: 'prj_a', message: 'sharedtoken' });
    expect(store.get(memory.id)).toMatchObject({ useCount: 0, lastUsedAt: null });

    recordInjection(store, preview, new Date(ISO));
    expect(store.get(memory.id)).toMatchObject({ useCount: 1, lastUsedAt: ISO });
  });

  it('uses the thread execution mode and rejects a mismatched thread', () => {
    store.upsert({ kind: 'rule', scope: 'global', text: 'plan first', appliesTo: 'plan' });

    const withoutThread = handlers['brain.preview']({ projectId: 'prj_a', message: '' });
    expect(withoutThread.always.map((entry) => entry.text)).not.toContain('plan first');

    const withThread = handlers['brain.preview']({
      projectId: 'prj_a',
      threadId: 'thr_a',
      message: '',
    });
    expect(withThread.always.map((entry) => entry.text)).toContain('plan first');

    expect(() =>
      handlers['brain.preview']({ projectId: 'prj_b', threadId: 'thr_a', message: '' }),
    ).toThrow('thread does not belong to project');
    expect(() =>
      handlers['brain.preview']({ projectId: 'prj_a', threadId: 'thr_missing', message: '' }),
    ).toThrow('thread not found');
  });
});
