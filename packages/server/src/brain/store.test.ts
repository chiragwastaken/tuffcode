import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brainDir } from '@tuffcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { createBrainStore, type BrainStore } from './store.js';

describe('brain store', () => {
  let ctx: TestContext;
  let store: BrainStore;

  beforeEach(() => {
    ctx = createTestContext();
    store = createBrainStore(ctx.repos.brain);
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('creates, updates, lists and deletes entries', () => {
    const created = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'prefers pnpm over npm',
      tags: 'tooling',
      importance: 0.7,
    });
    expect(created.id).toMatch(/^brn_/);
    expect(created.useCount).toBe(0);
    expect(created.active).toBe(true);
    expect(store.get(created.id)).toEqual(created);
    expect(store.list({ kind: 'memory' }).map((entry) => entry.id)).toEqual([created.id]);

    const updated = store.upsert({
      id: created.id,
      kind: 'memory',
      scope: 'global',
      text: 'prefers pnpm over npm, always',
      importance: 0.9,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.text).toBe('prefers pnpm over npm, always');
    expect(updated.importance).toBe(0.9);

    store.remove(created.id);
    expect(store.get(created.id)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it('reflects FTS updates and deletes through the content-sync triggers', () => {
    const entry = store.upsert({
      id: 'brn_fts',
      kind: 'memory',
      scope: 'global',
      text: 'zebra crossing protocol',
    });
    expect(store.list({ query: 'zebra' }).map((row) => row.id)).toEqual([entry.id]);
    expect(store.list({ query: 'giraffe' })).toEqual([]);

    store.upsert({
      id: entry.id,
      kind: 'memory',
      scope: 'global',
      text: 'giraffe migration protocol',
    });
    expect(store.list({ query: 'zebra' })).toEqual([]);
    expect(store.list({ query: 'giraffe' }).map((row) => row.id)).toEqual([entry.id]);

    store.remove(entry.id);
    expect(store.list({ query: 'giraffe' })).toEqual([]);
  });

  it('writes and removes the markdown mirror for rules and preferences', () => {
    const rule = store.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'never use npm',
      appliesTo: 'all',
    });
    const rulePath = join(brainDir(), 'rules', `${rule.id}.md`);
    expect(existsSync(rulePath)).toBe(true);
    expect(readFileSync(rulePath, 'utf8')).toContain('never use npm');

    const preference = store.upsert({
      kind: 'preference',
      scope: 'global',
      text: 'dark theme by default',
    });
    const preferencePath = join(brainDir(), 'preferences', `${preference.id}.md`);
    expect(existsSync(preferencePath)).toBe(true);
    expect(readFileSync(preferencePath, 'utf8')).toContain('dark theme by default');

    store.remove(rule.id);
    store.remove(preference.id);
    expect(existsSync(rulePath)).toBe(false);
    expect(existsSync(preferencePath)).toBe(false);

    const rekinded = store.upsert({ kind: 'rule', scope: 'global', text: 'temporary rule' });
    const rekindedPath = join(brainDir(), 'rules', `${rekinded.id}.md`);
    expect(existsSync(rekindedPath)).toBe(true);
    store.upsert({ id: rekinded.id, kind: 'memory', scope: 'global', text: 'now a memory' });
    expect(existsSync(rekindedPath)).toBe(false);
  });

  it('mirrors project entries into one file per project', () => {
    ctx.repos.projects.add({
      id: 'prj_alpha',
      name: 'alpha',
      path: 'C:/tmp/alpha',
      defaultBranch: 'main',
      createdAt: '2026-11-24T10:00:00.000Z',
    });
    store.upsert({
      kind: 'project',
      scope: 'project',
      projectId: 'prj_alpha',
      text: 'stack is Electron plus React',
    });
    const second = store.upsert({
      kind: 'project',
      scope: 'project',
      projectId: 'prj_alpha',
      text: 'tests run on vitest',
    });
    const path = join(brainDir(), 'projects', 'prj_alpha.md');
    expect(readFileSync(path, 'utf8')).toContain('stack is Electron plus React');
    expect(readFileSync(path, 'utf8')).toContain('tests run on vitest');

    store.remove(second.id);
    expect(readFileSync(path, 'utf8')).toContain('stack is Electron plus React');
    expect(readFileSync(path, 'utf8')).not.toContain('tests run on vitest');
  });

  it('bumps use_count and last_used_at when an entry is injected', () => {
    const entry = store.upsert({ kind: 'memory', scope: 'global', text: 'injected memory' });
    const at = '2026-11-24T10:00:00.000Z';
    store.touch([entry.id], at);
    expect(store.get(entry.id)).toMatchObject({ useCount: 1, lastUsedAt: at });
    store.touch([entry.id], at);
    expect(store.get(entry.id)?.useCount).toBe(2);
  });
});
