import type { Model, ProviderView } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { providerFamily, selectReviewer } from './family.js';

function provider(
  id: string,
  kind: ProviderView['kind'],
  config: Record<string, unknown> = {},
  enabled = true,
): ProviderView {
  const now = '2026-11-24T10:00:00.000Z';
  return {
    id,
    kind,
    label: id,
    config,
    enabled,
    hasSecret: false,
    createdAt: now,
    updatedAt: now,
  };
}

function model(providerId: string, modelId: string, isDefault = false): Model {
  return { providerId, modelId, label: modelId, contextWindow: null, isDefault };
}

const MODELS: Record<string, Model[]> = {
  prv_claude: [model('prv_claude', 'claude-x')],
  prv_codex: [model('prv_codex', 'gpt-x', true), model('prv_codex', 'gpt-small')],
  prv_acp: [model('prv_acp', 'gemini-x')],
};

function models(providerId: string): Model[] {
  return MODELS[providerId] ?? [];
}

describe('providerFamily', () => {
  it('maps fixed kinds and reads configured families', () => {
    expect(providerFamily('claude', {})).toBe('anthropic');
    expect(providerFamily('codex', {})).toBe('openai');
    expect(providerFamily('acp', {})).toBe('acp');
    expect(providerFamily('acp', { family: 'Google' })).toBe('google');
    expect(providerFamily('openai-compatible', { family: 'meta' })).toBe('meta');
    expect(providerFamily('openai-compatible', {})).toBe('openai-compatible');
  });
});

describe('selectReviewer', () => {
  it('picks an enabled provider whose family differs from the author', () => {
    const selection = selectReviewer({
      providers: [provider('prv_claude', 'claude'), provider('prv_codex', 'codex')],
      models,
      authorProviderId: 'prv_claude',
      authorModelId: 'claude-x',
    });
    expect(selection.providerId).toBe('prv_codex');
    expect(selection.modelId).toBe('gpt-x');
    expect(selection.sameFamily).toBe(false);
    expect(selection.authorFamily).toBe('anthropic');
  });

  it('skips disabled providers and providers without models', () => {
    const selection = selectReviewer({
      providers: [
        provider('prv_claude', 'claude'),
        provider('prv_codex', 'codex', {}, false),
        provider('prv_acp', 'acp', { family: 'google' }),
      ],
      models: (providerId) => (providerId === 'prv_acp' ? [] : models(providerId)),
      authorProviderId: 'prv_claude',
      authorModelId: 'claude-x',
    });
    expect(selection.sameFamily).toBe(true);
    expect(selection.providerId).toBe('prv_claude');
  });

  it('falls back to the author provider and model and labels the review', () => {
    const selection = selectReviewer({
      providers: [provider('prv_claude', 'claude'), provider('prv_other', 'claude')],
      models: (providerId) => [model(providerId, 'claude-x')],
      authorProviderId: 'prv_claude',
      authorModelId: 'claude-x',
    });
    expect(selection).toMatchObject({
      providerId: 'prv_claude',
      modelId: 'claude-x',
      sameFamily: true,
    });
  });

  it('treats two openai-compatible providers with different family fields as distinct', () => {
    const selection = selectReviewer({
      providers: [
        provider('prv_local', 'openai-compatible', { family: 'meta' }),
        provider('prv_remote', 'openai-compatible', { family: 'mistral' }),
      ],
      models: (providerId) => [model(providerId, 'model-x')],
      authorProviderId: 'prv_local',
      authorModelId: 'model-x',
    });
    expect(selection.providerId).toBe('prv_remote');
    expect(selection.sameFamily).toBe(false);
  });
});
