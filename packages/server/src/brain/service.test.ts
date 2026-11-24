import { DEFAULT_SETTINGS, type Settings } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrainHandlers, type BrainHandlers } from '../brain/handlers.js';
import { createTestContext, type TestContext } from '../test-support.js';
import {
  ALWAYS_TOKEN_BUDGET,
  RETRIEVAL_MAX_ENTRIES,
  RETRIEVAL_TOKEN_BUDGET,
  brainTokens,
} from './selector.js';
import { assembleBrain, renderBrainSlice } from './service.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('brain assembly', () => {
  let ctx: TestContext;
  let handlers: BrainHandlers;

  beforeEach(() => {
    ctx = createTestContext();
    handlers = createBrainHandlers({ repos: ctx.repos });
    for (const id of ['prj_a', 'prj_other']) {
      ctx.repos.projects.add({
        id,
        name: id,
        path: `C:/tmp/${id}`,
        defaultBranch: 'main',
        createdAt: NOW.toISOString(),
      });
    }
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'thread',
      providerId: 'prv_x',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('includes identity, matching rules, the project entry and the working note', () => {
    const identity = ctx.repos.brain.upsert({ kind: 'identity', scope: 'global', text: 'solo founder' });
    const allRule = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'always run pnpm',
      appliesTo: 'all',
    });
    const workRule = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'write tests',
      appliesTo: 'WORK',
    });
    const planRule = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'plan only',
      appliesTo: 'plan',
    });
    const project = ctx.repos.brain.upsert({
      kind: 'project',
      scope: 'project',
      projectId: 'prj_a',
      text: 'Electron plus React',
    });
    const note = ctx.repos.brain.upsert({
      kind: 'working-note',
      scope: 'thr_a',
      projectId: 'prj_a',
      text: 'mid refactor of the runner',
    });
    const otherNote = ctx.repos.brain.upsert({
      kind: 'working-note',
      scope: 'prj_a',
      projectId: 'prj_a',
      text: 'project note should lose to the thread note',
    });
    const inactive = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'inactive rule',
      appliesTo: 'all',
      active: false,
    });

    const assembly = assembleBrain(ctx.repos, settings(), {
      projectId: 'prj_a',
      threadId: 'thr_a',
      mode: 'work',
      message: '',
      now: NOW,
    });
    const ids = assembly.slice.always.map((entry) => entry.id);

    expect(ids).toContain(identity.id);
    expect(ids).toContain(allRule.id);
    expect(ids).toContain(workRule.id);
    expect(ids).not.toContain(planRule.id);
    expect(ids).toContain(project.id);
    expect(ids).toContain(note.id);
    expect(ids).not.toContain(otherNote.id);
    expect(ids).not.toContain(inactive.id);
    expect(assembly.injectedIds).toEqual(ids);
  });

  it('falls back to the project working note when the thread has none', () => {
    const projectNote = ctx.repos.brain.upsert({
      kind: 'working-note',
      scope: 'prj_a',
      projectId: 'prj_a',
      text: 'project scoped note',
    });
    const assembly = assembleBrain(ctx.repos, settings(), {
      projectId: 'prj_a',
      threadId: 'thr_a',
      mode: 'work',
      message: '',
      now: NOW,
    });
    expect(assembly.slice.always.map((entry) => entry.id)).toEqual([projectNote.id]);
  });

  it('drops preferences first under the always cap and never truncates a rule', () => {
    const rule = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: `long rule ${'y'.repeat(1200)}`,
      appliesTo: 'all',
      importance: 0.9,
    });
    ctx.repos.brain.upsert({
      kind: 'preference',
      scope: 'global',
      text: `important preference ${'a'.repeat(800)}`,
      importance: 0.95,
    });
    const low = ctx.repos.brain.upsert({
      kind: 'preference',
      scope: 'global',
      text: `low preference ${'b'.repeat(800)}`,
      importance: 0.05,
    });

    const assembly = assembleBrain(ctx.repos, settings(), {
      projectId: 'prj_a',
      mode: 'work',
      message: '',
      now: NOW,
    });

    expect(assembly.slice.always.map((entry) => entry.id)).toContain(rule.id);
    expect(assembly.slice.always.find((entry) => entry.id === rule.id)?.text).toBe(rule.text);
    expect(assembly.slice.always.map((entry) => entry.id)).not.toContain(low.id);
    expect(brainTokens(assembly.slice.always)).toBeLessThanOrEqual(ALWAYS_TOKEN_BUDGET);
  });

  it('caps retrieval at eight entries and its own token budget without always ids', () => {
    const preference = ctx.repos.brain.upsert({
      kind: 'preference',
      scope: 'global',
      text: 'sharedtoken preference',
    });
    for (let index = 0; index < 12; index += 1) {
      ctx.repos.brain.upsert({
        kind: 'memory',
        scope: 'global',
        text: `sharedtoken memory ${index} ${'x'.repeat(20)}`,
        importance: index / 12,
      });
    }

    const assembly = assembleBrain(ctx.repos, settings(), {
      projectId: 'prj_a',
      mode: 'work',
      message: 'sharedtoken',
      now: NOW,
    });

    expect(assembly.slice.retrieved.length).toBeLessThanOrEqual(RETRIEVAL_MAX_ENTRIES);
    expect(brainTokens(assembly.slice.retrieved)).toBeLessThanOrEqual(RETRIEVAL_TOKEN_BUDGET);
    const alwaysIds = new Set(assembly.slice.always.map((entry) => entry.id));
    for (const entry of assembly.slice.retrieved) expect(alwaysIds.has(entry.id)).toBe(false);
    expect(assembly.slice.always.map((entry) => entry.id)).toContain(preference.id);
    expect(new Set(assembly.slice.retrieved.map((entry) => entry.id)).size).toBe(
      assembly.slice.retrieved.length,
    );
  });

  it('skips retrieval when the brain is disabled but keeps the always block', () => {
    ctx.repos.brain.upsert({ kind: 'rule', scope: 'global', text: 'always run pnpm', appliesTo: 'all' });
    ctx.repos.brain.upsert({ kind: 'memory', scope: 'global', text: 'sharedtoken memory' });

    const assembly = assembleBrain(ctx.repos, settings({ brainEnabled: false }), {
      projectId: 'prj_a',
      mode: 'work',
      message: 'sharedtoken',
      now: NOW,
    });

    expect(assembly.slice.retrieved).toEqual([]);
    expect(assembly.slice.always).toHaveLength(1);
  });

  it('renders non-rule entries with tags and leaves rules out', () => {
    const rule = ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'always run pnpm',
      appliesTo: 'all',
    });
    const preference = ctx.repos.brain.upsert({
      kind: 'preference',
      scope: 'global',
      text: 'dark theme',
      tags: 'ui,theme',
    });

    const assembly = assembleBrain(ctx.repos, settings(), {
      projectId: 'prj_a',
      mode: 'work',
      message: '',
      now: NOW,
    });
    const rendered = renderBrainSlice(assembly.slice);

    expect(rendered).toContain('[preference] dark theme (ui,theme)');
    expect(rendered).not.toContain(rule.text);
    expect(rendered.split('\n').every((line) => line.startsWith('['))).toBe(true);
    expect(preference.tags).toBe('ui,theme');
  });

  it('previews the same slice without bumping use_count', () => {
    const memory = ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken memory',
    });
    ctx.repos.brain.upsert({ kind: 'rule', scope: 'global', text: 'always run pnpm', appliesTo: 'all' });

    const preview = handlers['brain.preview']({
      projectId: 'prj_a',
      threadId: 'thr_a',
      message: 'sharedtoken',
    });
    const expected = assembleBrain(ctx.repos, ctx.repos.settings.get(), {
      projectId: 'prj_a',
      threadId: 'thr_a',
      mode: 'work',
      message: 'sharedtoken',
    });

    expect(preview).toEqual(expected.slice);
    expect(ctx.repos.brain.get(memory.id)).toMatchObject({ useCount: 0, lastUsedAt: null });
  });
});
