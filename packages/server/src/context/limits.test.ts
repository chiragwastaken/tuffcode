import { DEFAULT_SETTINGS, type Model } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { discoverModels, mergeModels } from '../providers/models.js';
import { modelLimits, threadVision, type ModelLimits, type ModelLimitsInput } from './limits.js';

const ISO = '2026-01-01T00:00:00.000Z';

/** The one thread the vision cases seed. */
function threadOf(ctx: TestContext) {
  const thread = ctx.repos.threads.get('thr_vision');
  if (thread === undefined) throw new Error('the seeded thread is missing');
  return thread;
}

function modelRow(overrides: Partial<Model>): Model {
  return {
    providerId: 'prv_l',
    modelId: 'model-x',
    label: 'Model X',
    contextWindow: null,
    isDefault: false,
    ...overrides,
  };
}

function limits(overrides: Partial<ModelLimitsInput>): ModelLimits {
  return modelLimits({
    models: [],
    providerConfig: {},
    modelId: 'model-x',
    settings: DEFAULT_SETTINGS,
    ...overrides,
  });
}

describe('modelLimits', () => {
  it('takes the model row window and reports it as the model source', () => {
    const result = limits({
      models: [modelRow({ contextWindow: 128_000, maxOutputTokens: 4_096 })],
      providerConfig: {
        contextWindow: 999_999,
        models: [{ id: 'model-x', contextWindow: 555_555 }],
      },
    });

    expect(result).toEqual({
      contextWindow: 128_000,
      maxOutputTokens: 4_096,
      source: 'model',
    });
  });

  it('falls back to the config model row and reports the config source', () => {
    const result = limits({
      providerConfig: {
        contextWindow: 999_999,
        models: [{ id: 'model-x', contextWindow: 64_000, maxOutputTokens: 2_048 }],
      },
    });

    expect(result).toEqual({
      contextWindow: 64_000,
      maxOutputTokens: 2_048,
      source: 'config',
    });
  });

  it('falls back to the provider config window and reports the config source', () => {
    const result = limits({ providerConfig: { contextWindow: 32_000 } });

    expect(result).toEqual({
      contextWindow: 32_000,
      maxOutputTokens: DEFAULT_SETTINGS.maxOutputTokens,
      source: 'config',
    });
  });

  it('reports the default source when nothing declares a window', () => {
    const result = limits({});

    expect(result).toEqual({
      contextWindow: 200_000,
      maxOutputTokens: DEFAULT_SETTINGS.maxOutputTokens,
      source: 'default',
    });
  });

  it('keeps the settings output limit when no model declares one', () => {
    const result = limits({
      providerConfig: { contextWindow: 32_000 },
      settings: { ...DEFAULT_SETTINGS, maxOutputTokens: 1_234 },
    });

    expect(result.maxOutputTokens).toBe(1_234);
  });
});

describe('threadVision', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  function seed(vision: boolean): void {
    ctx.repos.providers.upsert({
      id: 'prv_vision',
      kind: 'openai-compatible',
      label: 'Vision',
      config: {
        baseUrl: 'https://gateway.test',
        capabilities: { tools: true, vision, reasoning: false, reasoningEfforts: [] },
      },
    });
    ctx.repos.projects.add({
      id: 'prj_vision',
      name: 'vision',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.threads.create({
      id: 'thr_vision',
      projectId: 'prj_vision',
      parentThreadId: null,
      title: 'vision',
      providerId: 'prv_vision',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: ctx.env.root,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
  }

  it('falls back to the provider toggle when the model row knows nothing', () => {
    seed(true);
    ctx.repos.providers.replaceModels('prv_vision', [
      { modelId: 'model-x', label: 'Model X', contextWindow: null, capabilities: null, isDefault: true },
    ]);

    expect(threadVision(ctx.repos, threadOf(ctx))).toBe(true);
  });

  it('falls back to the provider toggle when the model row was never written', () => {
    seed(true);

    expect(threadVision(ctx.repos, threadOf(ctx))).toBe(true);
  });

  it('honours a provider toggle that is off', () => {
    seed(false);

    expect(threadVision(ctx.repos, threadOf(ctx))).toBe(false);
  });

  it('lets a model row that declares vision:false win over an on toggle', () => {
    seed(true);
    ctx.repos.providers.replaceModels('prv_vision', [
      {
        modelId: 'model-x',
        label: 'Model X',
        contextWindow: null,
        capabilities: { tools: true, vision: false, reasoning: false, reasoningEfforts: [] },
        isDefault: true,
      },
    ]);

    expect(threadVision(ctx.repos, threadOf(ctx))).toBe(false);
  });

  it('lets a model row that declares vision:true win over an off toggle', () => {
    seed(false);
    ctx.repos.providers.replaceModels('prv_vision', [
      {
        modelId: 'model-x',
        label: 'Model X',
        contextWindow: null,
        capabilities: { tools: true, vision: true, reasoning: false, reasoningEfforts: [] },
        isDefault: true,
      },
    ]);

    expect(threadVision(ctx.repos, threadOf(ctx))).toBe(true);
  });

  it('keeps the provider toggle in charge after a hint-free /models refresh', async () => {
    seed(true);
    const provider = ctx.repos.providers.get('prv_vision');
    if (provider === undefined) throw new Error('the seeded provider is missing');
    const discovered = await discoverModels(provider, {
      secret: null,
      fetchFn: async () =>
        new Response(JSON.stringify({ data: [{ id: 'model-x', object: 'model' }] }), {
          status: 200,
        }),
    });
    // The endpoint published no modality hints, so discovery must leave the row unknown.
    expect(discovered.models).toHaveLength(1);
    expect(discovered.models[0]?.capabilities).toBeNull();

    ctx.repos.providers.replaceModels('prv_vision', mergeModels([], discovered.models, new Set()));

    expect(threadVision(ctx.repos, threadOf(ctx))).toBe(true);
  });
});
