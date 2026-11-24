import type { PromptSection } from '@tuffcode/prompt';
import { BASE_SYSTEM_PROMPT, CUSTOM_INSTRUCTIONS_HEADING, estimateTokens } from '@tuffcode/prompt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALWAYS_TOKEN_BUDGET, RETRIEVAL_TOKEN_BUDGET } from '../brain/selector.js';
import { RpcError } from '../errors.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { createPromptHandlers } from './rpc.js';
import { planPrompt } from './service.js';

const ISO = '2026-11-24T10:00:00.000Z';

interface PreviewResult {
  sections: PromptSection[];
  total: number;
}

function preview(ctx: TestContext, message: string): PreviewResult {
  const handler = createPromptHandlers({ repos: ctx.repos }).get('prompt.preview');
  if (handler === undefined) throw new Error('prompt.preview is not registered');
  return handler({ threadId: 'thr_p', message }) as PreviewResult;
}

describe('prompt planning', () => {
  let contexts: TestContext[] = [];

  function setup(): TestContext {
    const ctx = createTestContext();
    contexts.push(ctx);
    ctx.repos.projects.add({
      id: 'prj_p',
      name: 'preview',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.threads.create({
      id: 'thr_p',
      projectId: 'prj_p',
      parentThreadId: null,
      title: 'preview thread',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: 'main',
      createdAt: ISO,
      updatedAt: ISO,
    });
    return ctx;
  }

  beforeEach(() => {
    contexts = [];
  });

  afterEach(() => {
    for (const ctx of contexts) ctx.dispose();
    contexts = [];
  });

  it('returns exactly the sections the runner assembles, in order', () => {
    const ctx = setup();
    ctx.repos.settings.patch({ customInstructions: 'Prefer pnpm. Never force push.' });
    ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'never use emdash',
      appliesTo: 'all',
    });
    ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'preview must match the send path',
    });
    const message = 'how do I run the preview';
    const thread = ctx.repos.threads.get('thr_p');
    const project = ctx.repos.projects.get('prj_p');
    if (thread === undefined || project === undefined) throw new Error('fixture is incomplete');

    const plan = planPrompt(ctx.repos, {
      thread,
      project,
      message,
      settings: ctx.repos.settings.get(),
    });
    const result = preview(ctx, message);

    expect(result.sections).toEqual(plan.assembly.sections);
    expect(result.total).toBe(plan.assembly.total);
    expect(result.sections.map((section) => section.name)).toEqual([
      'base',
      'custom-instructions',
      'brain-always',
      'retrieved-memory',
      'turn-context',
      'user-message',
    ]);
    expect(result.sections[0]?.text).toBe(BASE_SYSTEM_PROMPT);
    expect(result.sections.at(-1)?.text).toBe(message);

    const system = result.sections
      .filter((section) => section.name !== 'user-message')
      .map((section) => section.text)
      .join('\n\n');
    expect(system).toBe(plan.assembly.systemPrompt);
    expect(system).toContain('Prefer pnpm. Never force push.');
    expect(system).toContain('never use emdash');
    expect(system).toContain('preview must match the send path');
    // A thread without a worktree previews against the project path.
    expect(system).toContain(ctx.env.root);
  });

  it('never advances brain usage counters', () => {
    const ctx = setup();
    const entry = ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'countercheck marker',
    });
    preview(ctx, 'countercheck');
    expect(ctx.repos.brain.get(entry.id)?.useCount).toBe(0);
    expect(ctx.repos.brain.get(entry.id)?.lastUsedAt).toBeNull();
  });

  it('caps custom instructions from settings at 300 tokens on a sentence boundary', () => {
    const ctx = setup();
    ctx.repos.settings.patch({
      customInstructions: 'Keep every answer short and concrete. '.repeat(80),
    });
    const section = preview(ctx, 'hello').sections.find(
      (entry) => entry.name === 'custom-instructions',
    );
    expect(section).toBeDefined();
    expect(section?.text.startsWith(CUSTOM_INSTRUCTIONS_HEADING)).toBe(true);
    const body = (section?.text ?? '').slice(CUSTOM_INSTRUCTIONS_HEADING.length).trim();
    expect(estimateTokens(body)).toBeLessThanOrEqual(300);
    expect(body.endsWith('concrete.')).toBe(true);
  });

  it('omits the custom section when settings hold only whitespace', () => {
    const ctx = setup();
    ctx.repos.settings.patch({ customInstructions: '   \n  ' });
    const result = preview(ctx, 'hello');
    expect(result.sections.map((section) => section.name)).toEqual([
      'base',
      'turn-context',
      'user-message',
    ]);
    expect(
      result.sections.some((section) => section.text.includes(CUSTOM_INSTRUCTIONS_HEADING)),
    ).toBe(false);
  });

  it('keeps the brain budgets at 400 tokens each', () => {
    const ctx = setup();
    for (let index = 0; index < 40; index += 1) {
      ctx.repos.brain.upsert({
        kind: 'preference',
        scope: 'global',
        text: `preference ${index} ${'detail '.repeat(20)}`,
        importance: 0.5,
      });
    }
    for (let index = 0; index < 20; index += 1) {
      ctx.repos.brain.upsert({
        kind: 'memory',
        scope: 'global',
        text: `budgetmarker ${index} ${'context '.repeat(20)}`,
        importance: 0.9,
      });
    }

    const result = preview(ctx, 'budgetmarker context');
    const always = result.sections.find((section) => section.name === 'brain-always');
    const retrieved = result.sections.find((section) => section.name === 'retrieved-memory');

    expect(ALWAYS_TOKEN_BUDGET).toBe(400);
    expect(RETRIEVAL_TOKEN_BUDGET).toBe(400);
    expect(always).toBeDefined();
    expect(retrieved).toBeDefined();
    expect(always?.tokens).toBeLessThanOrEqual(ALWAYS_TOKEN_BUDGET);
    expect(retrieved?.tokens).toBeLessThanOrEqual(RETRIEVAL_TOKEN_BUDGET);
  });

  it('rejects an unknown thread instead of previewing an empty prompt', () => {
    const ctx = setup();
    const handler = createPromptHandlers({ repos: ctx.repos }).get('prompt.preview');
    if (handler === undefined) throw new Error('prompt.preview is not registered');
    try {
      handler({ threadId: 'thr_missing', message: 'hello' });
      expect.unreachable('preview should throw for an unknown thread');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError);
      expect((error as RpcError).code).toBe('not-found');
    }
  });
});
