import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { RETRIEVAL_MAX_ENTRIES, RETRIEVAL_TOKEN_BUDGET, brainTokens } from './selector.js';
import { searchMemory } from './search.js';
import { createBrainStore, type BrainStore } from './store.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');

describe('memory search', () => {
  let ctx: TestContext;
  let store: BrainStore;

  beforeEach(() => {
    ctx = createTestContext();
    store = createBrainStore(ctx.repos.brain);
    for (const id of ['prj_a', 'prj_b']) {
      ctx.repos.projects.add({
        id,
        name: id,
        path: `C:/tmp/${id}`,
        defaultBranch: 'main',
        createdAt: NOW.toISOString(),
      });
    }
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('keeps project scope plus globals and drops other projects', () => {
    const project = store.upsert({
      kind: 'memory',
      scope: 'project',
      projectId: 'prj_a',
      text: 'emdash tokens live in the theme',
    });
    const global = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'emdash is a punctuation preference',
    });
    const other = store.upsert({
      kind: 'memory',
      scope: 'project',
      projectId: 'prj_b',
      text: 'emdash belongs to beta',
    });

    const ids = searchMemory(store, {
      projectId: 'prj_a',
      query: 'emdash',
      now: NOW,
    }).entries.map((entry) => entry.id);

    expect(ids).toContain(project.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(other.id);
  });

  it('searches globals only when no project is given', () => {
    const project = store.upsert({
      kind: 'memory',
      scope: 'project',
      projectId: 'prj_a',
      text: 'emdash project fact',
    });
    const global = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'emdash global fact',
    });

    const ids = searchMemory(store, { query: 'emdash', now: NOW }).entries.map((entry) => entry.id);

    expect(ids).toEqual([global.id]);
    expect(ids).not.toContain(project.id);
  });

  it('orders by score, importance before recency ties', () => {
    const low = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken low importance',
      importance: 0.1,
    });
    const high = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken high importance',
      importance: 0.9,
    });

    const entries = searchMemory(store, {
      projectId: 'prj_a',
      query: 'sharedtoken',
      now: NOW,
    }).entries;

    expect(entries.map((entry) => entry.id)).toEqual([high.id, low.id]);
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index - 1]!.score).toBeGreaterThanOrEqual(entries[index]!.score);
    }
  });

  it('explains the match with terms, importance, recency and scope', () => {
    store.upsert({
      kind: 'memory',
      scope: 'project',
      projectId: 'prj_a',
      text: 'the emdash theme',
      importance: 0.8,
    });
    store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'emdash everywhere',
      importance: 0.4,
    });

    const [projectHit, globalHit] = searchMemory(store, {
      projectId: 'prj_a',
      query: 'emdash theme',
      now: NOW,
    }).entries;

    expect(projectHit?.reason).toContain('matched "emdash", "theme"');
    expect(projectHit?.reason).toContain('importance 0.80');
    expect(projectHit?.reason).toMatch(/recency \d\.\d\d/);
    expect(projectHit?.reason).toContain('project scope');
    expect(globalHit?.reason).toContain('matched "emdash"');
    expect(globalHit?.reason).toContain('global scope');
  });

  it('respects the caller limit and the selector entry cap', () => {
    for (let index = 0; index < 12; index += 1) {
      store.upsert({
        kind: 'memory',
        scope: 'global',
        text: `sharedtoken ${index}`,
      });
    }

    expect(
      searchMemory(store, { projectId: 'prj_a', query: 'sharedtoken', limit: 3, now: NOW }).entries,
    ).toHaveLength(3);
    expect(
      searchMemory(store, { projectId: 'prj_a', query: 'sharedtoken', now: NOW }).entries.length,
    ).toBeLessThanOrEqual(RETRIEVAL_MAX_ENTRIES);
    expect(
      searchMemory(store, { projectId: 'prj_a', query: 'sharedtoken', limit: 99, now: NOW }).entries
        .length,
    ).toBeLessThanOrEqual(RETRIEVAL_MAX_ENTRIES);
  });

  it('applies the retrieval token budget', () => {
    for (let index = 0; index < 8; index += 1) {
      store.upsert({
        kind: 'memory',
        scope: 'global',
        text: `sharedtoken ${index} ${'x'.repeat(500)}`,
      });
    }

    const result = searchMemory(store, { projectId: 'prj_a', query: 'sharedtoken', now: NOW });
    const entries = result.entries.map((entry) => {
      const full = store.get(entry.id);
      if (full === undefined) throw new Error('search returned an unknown entry');
      return full;
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(RETRIEVAL_MAX_ENTRIES);
    expect(brainTokens(entries)).toBeLessThanOrEqual(RETRIEVAL_TOKEN_BUDGET);
  });

  it('never injects: usage counters stay untouched', () => {
    const entry = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken memory',
    });

    searchMemory(store, { projectId: 'prj_a', query: 'sharedtoken', now: NOW });

    expect(store.get(entry.id)).toMatchObject({ useCount: 0, lastUsedAt: null });
  });

  it('does not surface rules or identity entries, matching retrieval', () => {
    store.upsert({ kind: 'rule', scope: 'global', text: 'sharedtoken rule', appliesTo: 'all' });
    store.upsert({ kind: 'identity', scope: 'global', text: 'sharedtoken founder' });

    expect(
      searchMemory(store, { projectId: 'prj_a', query: 'sharedtoken', now: NOW }).entries,
    ).toEqual([]);
  });

  it('rejects an empty or whitespace-only query', () => {
    expect(() => searchMemory(store, { projectId: 'prj_a', query: '' })).toThrow(
      'query must not be empty',
    );
    expect(() => searchMemory(store, { projectId: 'prj_a', query: '   ' })).toThrow(
      'query must not be empty',
    );
  });
});
