import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { captureStandingRule, captureStandingRules } from './rules.js';
import { createBrainStore, type BrainStore } from './store.js';

describe('standing rule capture', () => {
  let ctx: TestContext;
  let store: BrainStore;

  beforeEach(() => {
    ctx = createTestContext();
    store = createBrainStore(ctx.repos.brain);
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('stores the quoted text as a rule that applies to every turn', () => {
    const message = 'always remember: use pnpm, never npm';
    const entry = captureStandingRule(store, { message });
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      kind: 'rule',
      text: 'use pnpm, never npm',
      appliesTo: 'all',
      scope: 'global',
      active: true,
      sourceQuote: message,
    });
    expect(store.list({ kind: 'rule' }).map((row) => row.id)).toEqual([entry?.id]);
  });

  it('accepts the phrase without a colon and is case insensitive', () => {
    expect(captureStandingRule(store, { message: 'Always Remember use tabs' })?.text).toBe(
      'use tabs',
    );
    expect(captureStandingRule(store, { message: 'ALWAYS REMEMBER:  ship small  ' })?.text).toBe(
      'ship small',
    );
  });

  it('collapses whitespace in the captured rule', () => {
    expect(captureStandingRule(store, { message: 'always remember: one   two\tthree' })?.text).toBe(
      'one two three',
    );
  });

  it('ignores messages without a rule phrase', () => {
    expect(captureStandingRule(store, { message: 'remember to run the tests' })).toBeNull();
    expect(captureStandingRule(store, { message: 'always remember:' })).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('captures one rule per matched sentence', () => {
    ctx.repos.projects.add({
      id: 'prj_rules',
      name: 'rules',
      path: 'C:/tmp/rules',
      defaultBranch: 'main',
      createdAt: '2026-11-24T10:00:00.000Z',
    });
    const ids = captureStandingRules(ctx.repos, {
      text: 'Always remember: run pnpm. From now on use tabs.\nNever use npm. Remember the tests.',
      projectId: 'prj_rules',
    });

    expect(ids).toHaveLength(3);
    const rules = store.list({ kind: 'rule' });
    expect(rules.map((entry) => entry.text).sort()).toEqual(
      ['run pnpm', 'From now on use tabs', 'Never use npm'].sort(),
    );
    for (const rule of rules) {
      expect(rule).toMatchObject({ appliesTo: 'all', scope: 'global', projectId: 'prj_rules' });
    }
  });

  it('stores each rule once and skips a duplicate normalized sentence', () => {
    ctx.repos.projects.add({
      id: 'prj_rules',
      name: 'rules',
      path: 'C:/tmp/rules',
      defaultBranch: 'main',
      createdAt: '2026-11-24T10:00:00.000Z',
    });
    const first = captureStandingRules(ctx.repos, {
      text: 'Always use pnpm for installs.',
      projectId: 'prj_rules',
    });
    expect(first).toHaveLength(1);

    const again = captureStandingRules(ctx.repos, {
      text: 'always use pnpm for installs',
      projectId: 'prj_rules',
    });
    expect(again).toEqual([]);
    expect(store.list({ kind: 'rule' })).toHaveLength(1);
  });

  it('derives the project from the thread when none is given', () => {
    const now = new Date('2026-11-24T10:00:00.000Z').toISOString();
    ctx.repos.projects.add({
      id: 'prj_rules',
      name: 'rules',
      path: 'C:/tmp/rules',
      defaultBranch: 'main',
      createdAt: now,
    });
    ctx.repos.threads.create({
      id: 'thr_rules',
      projectId: 'prj_rules',
      parentThreadId: null,
      title: 'rules thread',
      providerId: 'prv_x',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: now,
      updatedAt: now,
    });

    captureStandingRules(ctx.repos, { text: 'From now on ship small.', threadId: 'thr_rules' });

    expect(store.list({ kind: 'rule' })[0]?.projectId).toBe('prj_rules');
  });
});
