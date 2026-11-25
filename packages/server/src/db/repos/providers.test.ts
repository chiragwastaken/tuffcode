import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test-support.js';

describe('providers repo model metadata', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.providers.upsert({ id: 'prv_meta', kind: 'claude', label: 'Claude', config: {} });
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('stores and reads back max output, capabilities, reasoning effort and source', () => {
    const models = ctx.repos.providers.replaceModels('prv_meta', [
      {
        modelId: 'claude-opus-4-5',
        label: 'Opus 4.5',
        contextWindow: 200000,
        maxOutputTokens: 32000,
        capabilities: {
          tools: true,
          vision: true,
          reasoning: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
        reasoningEffort: 'high',
        source: 'sdk',
        isDefault: true,
      },
    ]);

    expect(models).toEqual([
      {
        providerId: 'prv_meta',
        modelId: 'claude-opus-4-5',
        label: 'Opus 4.5',
        contextWindow: 200000,
        maxOutputTokens: 32000,
        capabilities: {
          tools: true,
          vision: true,
          reasoning: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
        reasoningEffort: 'high',
        isDefault: true,
      },
    ]);
    expect(ctx.repos.providers.listModels('prv_meta')).toEqual(models);

    const stored = ctx.db
      .prepare(
        'SELECT max_output_tokens, capabilities, reasoning_effort, source FROM provider_models WHERE provider_id = ?',
      )
      .get('prv_meta');
    expect(stored).toEqual({
      max_output_tokens: 32000,
      capabilities: JSON.stringify({
        tools: true,
        vision: true,
        reasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
      }),
      reasoning_effort: 'high',
      source: 'sdk',
    });
  });

  it('leaves unknown metadata off the model instead of guessing', () => {
    const models = ctx.repos.providers.replaceModels('prv_meta', [
      { modelId: 'legacy', label: 'Legacy', contextWindow: null, isDefault: false },
    ]);

    expect(models).toEqual([
      {
        providerId: 'prv_meta',
        modelId: 'legacy',
        label: 'Legacy',
        contextWindow: null,
        isDefault: false,
      },
    ]);
    expect(models[0]).not.toHaveProperty('maxOutputTokens');
    expect(models[0]).not.toHaveProperty('capabilities');
    expect(models[0]).not.toHaveProperty('reasoningEffort');
  });

  it('reads malformed metadata as null without hiding the model', () => {
    ctx.repos.providers.replaceModels('prv_meta', [
      { modelId: 'odd', label: 'Odd', contextWindow: 1000, isDefault: false },
    ]);
    ctx.db
      .prepare(
        "UPDATE provider_models SET capabilities = '\"nope\"', reasoning_effort = 'turbo', max_output_tokens = 64 WHERE provider_id = ?",
      )
      .run('prv_meta');

    expect(ctx.repos.providers.listModels('prv_meta')).toEqual([
      {
        providerId: 'prv_meta',
        modelId: 'odd',
        label: 'Odd',
        contextWindow: 1000,
        maxOutputTokens: 64,
        capabilities: null,
        reasoningEffort: null,
        isDefault: false,
      },
    ]);
  });
});
