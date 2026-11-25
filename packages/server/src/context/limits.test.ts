import { DEFAULT_SETTINGS, type Model } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { modelLimits, type ModelLimits, type ModelLimitsInput } from './limits.js';

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
