import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { captureStandingRule } from './rules.js';
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
});
