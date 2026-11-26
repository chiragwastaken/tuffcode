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

describe('providers repo capability repair', () => {
  let ctx: TestContext;

  /** The object pre-fix discovery wrote when the payload declared nothing. */
  const STALE = { tools: true, vision: false, reasoning: false, reasoningEfforts: [] };

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.providers.upsert({
      id: 'prv_repair',
      kind: 'openai-compatible',
      label: 'Gateway',
      config: {},
    });
  });

  afterEach(() => {
    ctx.dispose();
  });

  function capabilitiesOf(modelId: string): unknown {
    return ctx.db
      .prepare('SELECT capabilities FROM provider_models WHERE provider_id = ? AND model_id = ?')
      .get('prv_repair', modelId)?.['capabilities'];
  }

  it('nulls a stored default-shaped row that carries no discovery source', () => {
    ctx.repos.providers.replaceModels('prv_repair', [
      {
        modelId: 'gpt-stale',
        label: 'Stale',
        contextWindow: null,
        capabilities: STALE,
        isDefault: true,
      },
    ]);
    expect(capabilitiesOf('gpt-stale')).toBe(JSON.stringify(STALE));

    expect(ctx.repos.providers.repairDefaultCapabilities()).toBe(1);

    expect(capabilitiesOf('gpt-stale')).toBeNull();
    expect(ctx.repos.providers.listModels('prv_repair')[0]).not.toHaveProperty('capabilities');
  });

  it('keeps capabilities a discovery path recorded with its source', () => {
    ctx.repos.providers.replaceModels('prv_repair', [
      {
        modelId: 'gpt-api',
        label: 'Api',
        contextWindow: null,
        capabilities: STALE,
        source: 'api',
        isDefault: false,
      },
    ]);

    expect(ctx.repos.providers.repairDefaultCapabilities()).toBe(0);

    expect(capabilitiesOf('gpt-api')).toBe(JSON.stringify(STALE));
  });

  it('keeps a stored object that differs from the default shape', () => {
    const declared = { tools: true, vision: true, reasoning: false, reasoningEfforts: [] };
    ctx.repos.providers.replaceModels('prv_repair', [
      {
        modelId: 'gpt-vision',
        label: 'Vision',
        contextWindow: null,
        capabilities: declared,
        isDefault: false,
      },
    ]);

    expect(ctx.repos.providers.repairDefaultCapabilities()).toBe(0);

    expect(capabilitiesOf('gpt-vision')).toBe(JSON.stringify(declared));
  });

  it('is idempotent and leaves a corrupt object alone', () => {
    ctx.repos.providers.replaceModels('prv_repair', [
      {
        modelId: 'gpt-stale',
        label: 'Stale',
        contextWindow: null,
        capabilities: STALE,
        isDefault: true,
      },
      { modelId: 'gpt-odd', label: 'Odd', contextWindow: null, isDefault: false },
    ]);
    ctx.db
      .prepare(
        "UPDATE provider_models SET capabilities = 'not json' WHERE provider_id = ? AND model_id = ?",
      )
      .run('prv_repair', 'gpt-odd');

    expect(ctx.repos.providers.repairDefaultCapabilities()).toBe(1);
    expect(ctx.repos.providers.repairDefaultCapabilities()).toBe(0);
    expect(capabilitiesOf('gpt-odd')).toBe('not json');
  });
});
