import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test-support.js';

describe('brain repo FTS sync', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('reflects inserts, updates and deletes through the FTS triggers', () => {
    const entry = ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'The deploy script uses pnpm',
      tags: 'deploy',
    });
    expect(ctx.repos.brain.list({ query: 'pnpm' }).map((row) => row.id)).toEqual([entry.id]);

    ctx.repos.brain.upsert({
      id: entry.id,
      kind: 'memory',
      scope: 'global',
      text: 'The release script uses bun',
      tags: 'release',
    });
    expect(ctx.repos.brain.list({ query: 'pnpm' })).toHaveLength(0);
    expect(ctx.repos.brain.list({ query: 'deploy' })).toHaveLength(0);
    expect(ctx.repos.brain.list({ query: 'bun' }).map((row) => row.id)).toEqual([entry.id]);

    ctx.repos.brain.remove(entry.id);
    expect(ctx.repos.brain.list({ query: 'bun' })).toHaveLength(0);
    expect(ctx.repos.brain.get(entry.id)).toBeUndefined();
  });

  it('filters by kind and project and ignores FTS syntax', () => {
    const memory = ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'remember the blue theme',
    });
    const rule = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'always run the tests',
      appliesTo: 'all',
    });

    expect(ctx.repos.brain.list({ kind: 'rule' }).map((row) => row.id)).toEqual([rule.id]);
    expect(ctx.repos.brain.list({ query: 'blue' }).map((row) => row.id)).toEqual([memory.id]);
    expect(ctx.repos.brain.list({ query: '" OR *' })).toHaveLength(0);
  });

  it('hides inactive rows unless the caller asks for them, plain and FTS alike', () => {
    const entry = ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'the deploy script uses pnpm',
    });
    ctx.repos.brain.upsert({
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      text: entry.text,
      active: false,
    });

    expect(ctx.repos.brain.list({})).toHaveLength(0);
    expect(ctx.repos.brain.list({ query: 'pnpm' })).toHaveLength(0);
    expect(ctx.repos.brain.list({ includeInactive: true }).map((row) => row.id)).toEqual([
      entry.id,
    ]);
    expect(
      ctx.repos.brain.list({ query: 'pnpm', includeInactive: true }).map((row) => row.id),
    ).toEqual([entry.id]);
  });

  it('preserves project scope when an upsert omits projectId', () => {
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: 'C:/tmp/alpha',
      defaultBranch: 'main',
      createdAt: '2026-11-24T10:00:00.000Z',
    });
    const entry = ctx.repos.brain.upsert({
      kind: 'project',
      scope: 'project',
      projectId: 'prj_a',
      text: 'Electron plus React',
    });

    const toggled = ctx.repos.brain.upsert({
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      text: entry.text,
      active: false,
    });
    expect(toggled.projectId).toBe('prj_a');
  });
});
