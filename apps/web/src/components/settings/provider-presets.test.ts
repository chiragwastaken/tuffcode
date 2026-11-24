import type { ProviderView } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_GROUPS,
  PROVIDER_PRESETS,
  authModeLabel,
  defaultModelOf,
  presetById,
  presetForProvider,
  presetsInGroup,
  providerAuthMode,
  providerGroup,
  providerModels,
} from './provider-presets';

function view(
  overrides: Partial<ProviderView> & { config?: Record<string, unknown> },
): ProviderView {
  return {
    id: 'prov-1',
    kind: 'openai-compatible',
    label: 'Provider',
    config: {},
    enabled: true,
    hasSecret: false,
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('provider preset catalog', () => {
  it('has unique ids and the sections the gallery renders', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROVIDER_GROUPS.map((group) => group.id)).toEqual([
      'subscriptions',
      'api',
      'local',
      'agents',
    ]);
    for (const group of PROVIDER_GROUPS) {
      expect(presetsInGroup(group.id).length, group.id).toBeGreaterThan(0);
    }
  });

  it('gives every card a label, a one-line description, and an auth mode', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.label.trim(), preset.id).not.toBe('');
      expect(preset.description.trim(), preset.id).not.toBe('');
      expect(preset.auth, preset.id).toBeTruthy();
      expect(preset.kind, preset.id).toBeTruthy();
      expect(
        preset.models.every((model) => model.id && model.label),
        preset.id,
      ).toBe(true);
    }
  });

  it('lists exactly the subscription cards and gives them no endpoint', () => {
    const subscriptions = presetsInGroup('subscriptions');
    expect(subscriptions.map((preset) => preset.id)).toEqual(['claude', 'chatgpt']);
    expect(subscriptions.map((preset) => preset.kind)).toEqual(['claude', 'codex']);
    expect(subscriptions.every((preset) => preset.baseUrl === undefined)).toBe(true);
    expect(subscriptions.every((preset) => preset.auth === 'subscription')).toBe(true);
  });

  it('ships the documented hosted API presets', () => {
    const api = presetsInGroup('api');
    expect(api.map((preset) => preset.id)).toEqual([
      'anthropic-api',
      'openai',
      'openrouter',
      'deepseek',
      'kimi',
      'groq',
      'mistral',
      'xai',
      'together',
      'gemini',
      'copilot',
      'azure-openai',
      'custom-openai',
    ]);
    for (const preset of api) {
      if (preset.custom) {
        // Custom cards start on the full form; a pattern may still prefill the URL.
        if (preset.baseUrl !== undefined) expect(preset.baseUrl, preset.id).toMatch(/^https:\/\//);
        continue;
      }
      expect(preset.baseUrl, preset.id).toMatch(/^https:\/\//);
      expect(preset.docsUrl, preset.id).toMatch(/^https:\/\//);
      expect(preset.models.length, preset.id).toBeGreaterThan(0);
    }
  });

  it('seeds the documented context windows and output budgets', () => {
    const limits = Object.fromEntries(
      PROVIDER_PRESETS.map((preset) => [preset.id, [preset.contextWindow, preset.maxOutputTokens]]),
    );
    expect(limits['anthropic-api']).toEqual([200_000, 8_192]);
    expect(limits['openai']).toEqual([128_000, 16_384]);
    expect(limits['openrouter']).toEqual([128_000, 8_192]);
    expect(limits['deepseek']).toEqual([64_000, 8_192]);
    expect(limits['kimi']).toEqual([256_000, 8_192]);
    expect(limits['groq']).toEqual([128_000, 8_192]);
    expect(limits['gemini']).toEqual([1_000_000, 8_192]);
    expect(limits['ollama']).toEqual([32_000, 4_096]);
    expect(limits['lmstudio']).toEqual([32_000, 4_096]);
    expect(limits['vllm']).toEqual([32_000, 4_096]);
  });

  it('describes the Copilot and Azure endpoints with their required headers', () => {
    const copilot = presetById('copilot');
    expect(copilot).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://api.githubcopilot.com',
      auth: 'api-key',
      requiresSecret: true,
      family: 'github-copilot',
    });
    expect(copilot?.headers).toEqual({
      'Editor-Version': 'vscode/1.99.0',
      'Copilot-Integration-Id': 'vscode-chat',
    });

    const azure = presetById('azure-openai');
    expect(azure).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
      auth: 'api-key',
      requiresSecret: true,
      custom: true,
      family: 'azure-openai',
    });
    expect(azure?.headers).toEqual({ 'api-version': '2024-10-21' });
  });

  it('prefills the local endpoints from the spec', () => {
    const local = presetsInGroup('local');
    expect(Object.fromEntries(local.map((preset) => [preset.id, preset.baseUrl]))).toEqual({
      ollama: 'http://127.0.0.1:11434/v1',
      lmstudio: 'http://127.0.0.1:1234/v1',
      vllm: 'http://127.0.0.1:8000/v1',
    });
  });

  it('lists OpenCode and a custom ACP agent', () => {
    const agents = presetsInGroup('agents');
    expect(agents.map((preset) => preset.id)).toEqual(['opencode', 'acp']);
    expect(agents.map((preset) => preset.kind)).toEqual(['opencode', 'acp']);
  });

  it('looks presets up by id', () => {
    expect(presetById('openrouter')?.label).toBe('OpenRouter');
    expect(presetById('nope')).toBeUndefined();
    expect(presetById(undefined)).toBeUndefined();
  });
});

describe('presetForProvider', () => {
  it('reads the recorded preset id first', () => {
    const preset = presetForProvider(view({ config: { preset: 'groq' } }));
    expect(preset?.id).toBe('groq');
  });

  it('infers subscription and agent presets from the kind', () => {
    expect(presetForProvider(view({ kind: 'claude' }))?.id).toBe('claude');
    expect(presetForProvider(view({ kind: 'codex' }))?.id).toBe('chatgpt');
    expect(presetForProvider(view({ kind: 'anthropic' }))?.id).toBe('anthropic-api');
    expect(presetForProvider(view({ kind: 'acp' }))?.id).toBe('acp');
    expect(presetForProvider(view({ kind: 'opencode' }))?.id).toBe('opencode');
  });

  it('matches a legacy OpenAI-compatible row by its base URL', () => {
    expect(
      presetForProvider(view({ config: { baseUrl: 'https://openrouter.ai/api/v1/' } }))?.id,
    ).toBe('openrouter');
    expect(presetForProvider(view({ config: { baseUrl: 'http://127.0.0.1:11434/v1' } }))?.id).toBe(
      'ollama',
    );
  });

  it('falls back to the custom preset for an unknown hosted endpoint', () => {
    expect(
      presetForProvider(view({ config: { baseUrl: 'https://models.example.com/v1' } }))?.id,
    ).toBe('custom-openai');
  });

  it('falls back to vLLM for an unknown loopback endpoint', () => {
    expect(presetForProvider(view({ config: { baseUrl: 'http://localhost:9999/v1' } }))?.id).toBe(
      'vllm',
    );
  });
});

describe('provider display helpers', () => {
  it('groups rows under the gallery sections', () => {
    expect(providerGroup(view({ kind: 'claude' }))).toBe('subscriptions');
    expect(providerGroup(view({ config: { preset: 'openai' } }))).toBe('api');
    expect(providerGroup(view({ config: { preset: 'ollama' } }))).toBe('local');
    expect(providerGroup(view({ kind: 'acp' }))).toBe('agents');
  });

  it('labels the auth mode', () => {
    expect(providerAuthMode(view({ kind: 'claude' }))).toBe('subscription');
    expect(providerAuthMode(view({ config: { preset: 'openai' } }))).toBe('api-key');
    expect(providerAuthMode(view({ config: { preset: 'ollama' } }))).toBe('local');
    expect(providerAuthMode(view({ kind: 'acp' }))).toBe('cli');
    expect(authModeLabel('subscription')).toBe('Subscription');
    expect(authModeLabel('api-key')).toBe('API key');
  });

  it('reads the default model from the config, then the model list', () => {
    expect(defaultModelOf(view({ config: { model: 'gpt-5.1' } }))).toBe('gpt-5.1');
    expect(
      defaultModelOf(
        view({
          config: {
            models: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B', isDefault: true },
            ],
          },
        }),
      ),
    ).toBe('b');
    expect(defaultModelOf(view({ kind: 'claude', config: {} }))).toBe('claude-opus-4-5');
  });

  it('reads the model list with labels and falls back to config.model', () => {
    expect(
      providerModels(
        view({
          config: {
            models: [
              { id: 'gpt-5.1', label: 'GPT-5.1' },
              { id: 4, label: 'bad' },
            ],
          },
        }),
      ),
    ).toEqual([{ id: 'gpt-5.1', label: 'GPT-5.1' }]);
    expect(providerModels(view({ config: { model: 'qwen' } }))).toEqual([
      { id: 'qwen', label: 'qwen' },
    ]);
    expect(providerModels(view({ config: {} }))).toEqual([]);
  });

  it('keeps per-model token overrides and drops invalid ones', () => {
    expect(
      providerModels(
        view({
          config: {
            models: [
              { id: 'a', label: 'A', contextWindow: 64_000, maxOutputTokens: 8_192 },
              { id: 'b', label: 'B', contextWindow: 0, maxOutputTokens: -1 },
              { id: 'c', label: 'C', contextWindow: 1.5 },
            ],
          },
        }),
      ),
    ).toEqual([
      { id: 'a', label: 'A', contextWindow: 64_000, maxOutputTokens: 8_192 },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
  });
});
