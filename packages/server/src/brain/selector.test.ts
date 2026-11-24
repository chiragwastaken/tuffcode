import { estimateTokens } from '@tuffcode/prompt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../db/index.js';
import { createTestContext, type TestContext } from '../test-support.js';
import {
  ALWAYS_TOKEN_BUDGET,
  RETRIEVAL_MAX_ENTRIES,
  RETRIEVAL_TOKEN_BUDGET,
  brainTokens,
  recordInjection,
  renderBrainEntries,
  selectBrain,
} from './selector.js';
import { createBrainStore, type BrainStore } from './store.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');

describe('brain selector', () => {
  let ctx: TestContext;
  let store: BrainStore;

  beforeEach(() => {
    ctx = createTestContext();
    store = createBrainStore(ctx.repos.brain);
    for (const id of ['prj_a', 'prj_other']) {
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

  it('never exceeds the budget with 200 candidate entries', () => {
    // Seed through the repository in one transaction. This test measures the
    // selector; 200 autocommitted inserts plus per-entry mirror work are filesystem
    // I/O and pushed the test past the CI timeout on windows-latest.
    transaction(ctx.db, () => {
      for (let index = 0; index < 200; index += 1) {
        ctx.repos.brain.upsert({
          kind: 'memory',
          scope: 'global',
          text: `memory ${index} sharedtoken ${'x'.repeat(120)}`,
          importance: (index % 10) / 10,
        });
      }
      ctx.repos.brain.upsert({ kind: 'identity', scope: 'global', text: 'solo founder' });
      ctx.repos.brain.upsert({
        kind: 'rule',
        scope: 'global',
        text: 'never use npm',
        appliesTo: 'all',
      });
      ctx.repos.brain.upsert({
        kind: 'preference',
        scope: 'global',
        text: 'dark theme',
        importance: 0.8,
      });
      ctx.repos.brain.upsert({
        kind: 'project',
        scope: 'project',
        projectId: 'prj_a',
        text: 'Electron plus React',
      });
      ctx.repos.brain.upsert({
        kind: 'working-note',
        scope: 'project',
        text: 'mid refactor of the selector',
      });
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: 'sharedtoken',
      mode: 'work',
      now: NOW,
    });

    expect(slice.retrieved.length).toBeLessThanOrEqual(RETRIEVAL_MAX_ENTRIES);
    expect(brainTokens(slice.always)).toBeLessThanOrEqual(ALWAYS_TOKEN_BUDGET);
    expect(brainTokens(slice.retrieved)).toBeLessThanOrEqual(RETRIEVAL_TOKEN_BUDGET);
    expect(slice.tokens).toBeLessThanOrEqual(ALWAYS_TOKEN_BUDGET + RETRIEVAL_TOKEN_BUDGET);
    expect(new Set(slice.retrieved.map((entry) => entry.id)).size).toBe(slice.retrieved.length);
    for (const entry of slice.retrieved) {
      expect(slice.always.map((always) => always.id)).not.toContain(entry.id);
    }
  });

  it('always includes rules that apply to the turn kind and never truncates them', () => {
    const allRule = store.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'always run pnpm',
      appliesTo: 'all',
      importance: 0.5,
    });
    const planRule = store.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'plan only rule',
      appliesTo: 'plan',
      importance: 0.9,
    });
    transaction(ctx.db, () => {
      for (let index = 0; index < 40; index += 1) {
        ctx.repos.brain.upsert({
          kind: 'preference',
          scope: 'global',
          text: `preference ${index} ${'z'.repeat(400)}`,
          importance: index / 100,
        });
      }
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: '',
      mode: 'work',
      now: NOW,
    });

    const ids = slice.always.map((entry) => entry.id);
    expect(ids).toContain(allRule.id);
    expect(ids).not.toContain(planRule.id);
    expect(brainTokens(slice.always)).toBeLessThanOrEqual(ALWAYS_TOKEN_BUDGET);
  });

  it('keeps rules whole even when they alone exceed the budget', () => {
    const longRule = store.upsert({
      kind: 'rule',
      scope: 'global',
      text: `long rule ${'y'.repeat(4000)}`,
      appliesTo: 'all',
    });
    store.upsert({
      kind: 'preference',
      scope: 'global',
      text: `preference ${'z'.repeat(2000)}`,
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: '',
      mode: 'work',
      now: NOW,
    });

    expect(slice.always.map((entry) => entry.id)).toEqual([longRule.id]);
    expect(slice.always[0]?.text).toBe(longRule.text);
    expect(brainTokens(slice.always)).toBeGreaterThan(ALWAYS_TOKEN_BUDGET);
  });

  it('drops low importance preferences before touching rules', () => {
    store.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'keep me',
      appliesTo: 'all',
      importance: 0.1,
    });
    store.upsert({
      kind: 'preference',
      scope: 'global',
      text: `important preference ${'a'.repeat(1200)}`,
      importance: 0.9,
    });
    store.upsert({
      kind: 'preference',
      scope: 'global',
      text: `low preference ${'b'.repeat(1200)}`,
      importance: 0.1,
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: '',
      mode: 'work',
      now: NOW,
    });

    expect(slice.always.some((entry) => entry.text.startsWith('keep me'))).toBe(true);
    expect(slice.always.some((entry) => entry.text.startsWith('low preference'))).toBe(false);
    expect(slice.always.some((entry) => entry.text.startsWith('important preference'))).toBe(true);
  });

  it('dedupes entries already present in the always block', () => {
    const preference = store.upsert({
      kind: 'preference',
      scope: 'global',
      text: 'sharedtoken preference',
    });
    const memory = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken memory',
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: 'sharedtoken',
      now: NOW,
    });

    expect(slice.always.map((entry) => entry.id)).toContain(preference.id);
    expect(slice.retrieved.map((entry) => entry.id)).toContain(memory.id);
    expect(slice.retrieved.map((entry) => entry.id)).not.toContain(preference.id);
  });

  it('scores retrieval with importance and keeps other projects out', () => {
    const high = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken high importance',
      importance: 0.95,
    });
    const low = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken low importance',
      importance: 0.05,
    });
    const otherProject = store.upsert({
      kind: 'memory',
      scope: 'project',
      projectId: 'prj_other',
      text: 'sharedtoken other project',
      importance: 1,
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: 'sharedtoken',
      now: NOW,
    });

    expect(slice.retrieved[0]?.id).toBe(high.id);
    expect(slice.retrieved.map((entry) => entry.id)).toContain(low.id);
    expect(slice.retrieved.map((entry) => entry.id)).not.toContain(otherProject.id);
  });

  it('records an injection by bumping use_count and last_used_at', () => {
    const rule = store.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'inject me',
      appliesTo: 'all',
    });
    const memory = store.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken memory',
    });

    const { slice } = selectBrain(store, {
      projectId: 'prj_a',
      message: 'sharedtoken',
      now: NOW,
    });
    recordInjection(store, slice, NOW);

    expect(store.get(rule.id)).toMatchObject({
      useCount: 1,
      lastUsedAt: NOW.toISOString(),
    });
    expect(store.get(memory.id)).toMatchObject({
      useCount: 1,
      lastUsedAt: NOW.toISOString(),
    });
  });

  it('uses the same token estimate as @tuffcode/prompt', () => {
    store.upsert({ kind: 'rule', scope: 'global', text: 'abcd', appliesTo: 'all' });
    store.upsert({ kind: 'memory', scope: 'global', text: 'sharedtoken abcde' });

    const { slice, text } = selectBrain(store, {
      projectId: 'prj_a',
      message: 'sharedtoken',
      now: NOW,
    });

    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(text).toBe(renderBrainEntries([...slice.always, ...slice.retrieved]));
    expect(slice.tokens).toBe(estimateTokens(text));
    expect(slice.tokens).toBe(Math.ceil(text.length / 4));
  });
});
