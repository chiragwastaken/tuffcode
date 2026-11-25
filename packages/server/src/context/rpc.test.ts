import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError } from '../errors.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { createContextHandlers } from './rpc.js';

const ISO = '2026-11-24T10:00:00.000Z';

interface ContextResult {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  limitSource: 'model' | 'config' | 'settings' | 'default';
  segments: { name: string; tokens: number }[];
}

function contextHandler(ctx: TestContext): (threadId: string) => ContextResult {
  const registered = createContextHandlers({ repos: ctx.repos }).get('threads.context');
  if (registered === undefined) throw new Error('threads.context is not registered');
  return (threadId: string): ContextResult => registered({ threadId }) as ContextResult;
}

describe('threads.context', () => {
  let contexts: TestContext[] = [];

  function setup(): TestContext {
    const ctx = createTestContext();
    contexts.push(ctx);
    ctx.repos.projects.add({
      id: 'prj_c',
      name: 'context',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.providers.upsert({
      id: 'prv_c',
      kind: 'claude',
      label: 'Context',
      config: { contextWindow: 5000 },
    });
    ctx.repos.threads.create({
      id: 'thr_c',
      projectId: 'prj_c',
      parentThreadId: null,
      title: 'context thread',
      providerId: 'prv_c',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: ctx.env.root,
      branch: 'tuffcode/thr_c',
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

  it('recomputes the assembled prompt plus the conversation against the model window', () => {
    const ctx = setup();
    ctx.repos.messages.add({
      id: 'msg_c1',
      threadId: 'thr_c',
      role: 'user',
      content: 'hello context',
      createdAt: ISO,
    });
    ctx.repos.messages.add({
      id: 'msg_c2',
      threadId: 'thr_c',
      role: 'assistant',
      content: 'abcd',
      createdAt: ISO,
    });
    ctx.repos.events.append('thr_c', 'tool.finished', {
      type: 'tool.finished',
      turnId: 'turn_c',
      toolCallId: 'call_1',
      output: '12345678',
      isError: false,
    });

    const result = contextHandler(ctx)('thr_c');

    expect(result.maxTokens).toBe(5000);
    expect(result.limitSource).toBe('config');
    expect(result.segments.map((segment) => segment.name)).toContain('base');
    // The last user message is part of the prompt, so only the assistant row remains.
    expect(result.segments.find((segment) => segment.name === 'messages')).toEqual({
      name: 'messages',
      tokens: 1,
    });
    expect(result.segments.find((segment) => segment.name === 'harness-history')).toEqual({
      name: 'harness-history',
      tokens: 2,
    });
    expect(result.usedTokens).toBe(
      result.segments.reduce((sum, segment) => sum + segment.tokens, 0),
    );
    expect(result.percent).toBeCloseTo(result.usedTokens / 5000);
  });

  it('reports the model row window and its source', () => {
    const ctx = setup();
    ctx.repos.providers.replaceModels('prv_c', [
      { modelId: 'model-x', label: 'Model X', contextWindow: 12_000, isDefault: true },
    ]);

    const result = contextHandler(ctx)('thr_c');

    expect(result.maxTokens).toBe(12_000);
    expect(result.limitSource).toBe('model');
  });

  it('reports the default window when the provider declares none', () => {
    const ctx = setup();
    ctx.repos.providers.upsert({
      id: 'prv_c',
      kind: 'claude',
      label: 'Context',
      config: {},
    });

    const result = contextHandler(ctx)('thr_c');

    expect(result.maxTokens).toBe(200_000);
    expect(result.limitSource).toBe('default');
    expect(result.percent).toBeGreaterThan(0);
    expect(result.percent).toBeLessThan(1);
  });

  it('rejects an unknown thread with not-found', () => {
    const ctx = setup();

    try {
      contextHandler(ctx)('thr_missing');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError);
      expect((error as RpcError).code).toBe('not-found');
    }
  });
});
