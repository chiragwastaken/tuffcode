import { methods, type ProviderKind, type ProviderView } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildProviderPayload,
  headersToText,
  parseHeadersText,
  parseReasoningEfforts,
  providerDraftFromPreset,
  providerDraftFromView,
  updateModelLimit,
  validateModelLimits,
  validateProviderDraft,
  type ProviderDraft,
} from './provider-form';
import { presetById } from './provider-presets';

function draft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    kind: 'openai-compatible',
    presetId: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.1',
    models: [
      { id: 'gpt-5.1', label: 'gpt-5.1' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
    headers: '',
    secret: 'sk-test',
    configDir: '',
    command: '',
    contextWindow: '',
    maxOutputTokens: '',
    capabilities: { tools: true, vision: false, reasoning: false },
    reasoningEfforts: '',
    reasoningEffort: '',
    ...overrides,
  };
}

function subscriptionDraft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    kind: 'claude',
    presetId: 'claude',
    label: 'Claude',
    baseUrl: '',
    model: '',
    models: [
      { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
      { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    ],
    headers: '',
    secret: '',
    configDir: '',
    command: '',
    contextWindow: '',
    maxOutputTokens: '',
    capabilities: { tools: true, vision: false, reasoning: false },
    reasoningEfforts: '',
    reasoningEffort: '',
    ...overrides,
  };
}

const providerView: ProviderView = {
  id: 'prov-1',
  kind: 'openai-compatible',
  label: 'Local model',
  config: {
    preset: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen3-coder',
    models: [
      { id: 'qwen3-coder', label: 'qwen3-coder', isDefault: true },
      { id: 'gpt-oss-20b', label: 'gpt-oss-20b' },
    ],
    headers: { 'X-Org': 'team' },
    family: 'local',
  },
  enabled: true,
  hasSecret: true,
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
};

describe('validateProviderDraft', () => {
  it('accepts a complete API provider', () => {
    expect(validateProviderDraft(draft())).toEqual({});
  });

  it('requires a label, base URL, model, and key for a new API provider', () => {
    expect(
      validateProviderDraft(
        draft({ label: '   ', baseUrl: '', model: '', secret: '', presetId: 'openai' }),
      ),
    ).toEqual({
      label: 'Label is required.',
      baseUrl: 'Base URL is required.',
      model: 'Choose or enter a model.',
      secret: 'API key is required.',
    });
  });

  it('does not require a key when editing a provider that already has one', () => {
    expect(
      validateProviderDraft(draft({ secret: '' }), { isNew: false, hasExistingSecret: true }),
    ).toEqual({});
  });

  it('rejects malformed and non-http base URLs', () => {
    expect(validateProviderDraft(draft({ baseUrl: 'not a url' }))).toEqual({
      baseUrl: 'Enter a valid URL.',
    });
    expect(validateProviderDraft(draft({ baseUrl: 'ftp://example.com' }))).toEqual({
      baseUrl: 'Base URL must use http or https.',
    });
  });

  it('lets subscription providers omit the base URL, key, and model', () => {
    expect(validateProviderDraft(subscriptionDraft())).toEqual({});
    expect(validateProviderDraft(subscriptionDraft({ configDir: 'C:\\claude-config' }))).toEqual(
      {},
    );
  });

  it('rejects a relative subscription config directory', () => {
    expect(validateProviderDraft(subscriptionDraft({ configDir: 'relative/path' }))).toEqual({
      configDir: 'Enter an absolute path.',
    });
  });

  it('requires a base URL and model for local providers but no key', () => {
    const local = subscriptionDraft({
      kind: 'openai-compatible',
      presetId: 'ollama',
      label: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: '',
      secret: '',
    });
    expect(validateProviderDraft(local)).toEqual({ model: 'Choose or enter a model.' });
  });

  it('requires a command for a custom ACP agent but not for OpenCode', () => {
    expect(
      validateProviderDraft(subscriptionDraft({ kind: 'acp', presetId: 'acp', label: 'ACP' })),
    ).toEqual({ command: 'Command is required for an ACP agent.' });
    expect(
      validateProviderDraft(subscriptionDraft({ kind: 'opencode', presetId: 'opencode' })),
    ).toEqual({});
  });

  it('rejects headers that are not a JSON object of strings', () => {
    expect(validateProviderDraft(draft({ headers: 'nope' }))).toEqual({
      headers: 'Headers must be valid JSON.',
    });
    expect(validateProviderDraft(draft({ headers: '[]' }))).toEqual({
      headers: 'Headers must be a JSON object.',
    });
    expect(validateProviderDraft(draft({ headers: '{"X-Org": 4}' }))).toEqual({
      headers: 'Header X-Org must be a string.',
    });
    expect(validateProviderDraft(draft({ headers: '{"Bad Header": "x"}' }))).toEqual({
      headers: 'Invalid header name: Bad Header',
    });
  });

  it('ignores stale headers on subscription drafts', () => {
    expect(validateProviderDraft(subscriptionDraft({ headers: 'nope' }))).toEqual({});
  });

  it('reports an unknown provider kind', () => {
    expect(validateProviderDraft(draft({ kind: 'bogus' as ProviderKind }))).toEqual({
      kind: 'Choose a provider kind.',
    });
  });
});

describe('parseHeadersText', () => {
  it('returns an empty object for blank input', () => {
    expect(parseHeadersText('  ')).toEqual({ headers: {} });
  });

  it('parses string values', () => {
    expect(parseHeadersText('{"X-Org":"team","Authorization":"Bearer x"}')).toEqual({
      headers: { 'X-Org': 'team', Authorization: 'Bearer x' },
    });
  });
});

describe('buildProviderPayload', () => {
  it('trims values and includes a provided secret', () => {
    const payload = buildProviderPayload(
      draft({
        label: '  OpenAI  ',
        baseUrl: ' https://api.openai.com/v1 ',
        model: ' gpt-5 ',
        secret: ' sk-openai ',
      }),
    );

    expect(payload.kind).toBe('openai-compatible');
    expect(payload.label).toBe('OpenAI');
    expect(payload.secret).toBe('sk-openai');
    expect(payload.config).toMatchObject({
      preset: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      family: 'openai',
    });
    expect(methods['providers.upsert'].params.safeParse(payload).success).toBe(true);
  });

  it('omits the secret when the write-only field is blank', () => {
    const payload = buildProviderPayload(draft({ secret: '   ' }), {
      id: 'prov-1',
      existingConfig: { family: 'openai', maxTokens: 4096 },
    });

    expect(payload).not.toHaveProperty('secret');
    expect(payload.id).toBe('prov-1');
    expect(payload.config).toMatchObject({ maxTokens: 4096, preset: 'openai' });
  });

  it('never sends a base URL, headers, or secret for a subscription', () => {
    const payload = buildProviderPayload(
      subscriptionDraft({
        baseUrl: 'https://api.anthropic.com/v1',
        headers: '{"Authorization":"Bearer leaked"}',
        secret: 'sk-should-not-leak',
      }),
    );

    expect(payload).not.toHaveProperty('secret');
    expect(payload.config).not.toHaveProperty('baseUrl');
    expect(payload.config).not.toHaveProperty('headers');
    expect(payload.config.preset).toBe('claude');
    expect(methods['providers.upsert'].params.safeParse(payload).success).toBe(true);
  });

  it('seeds the subscription model list and stores an advanced override', () => {
    const payload = buildProviderPayload(
      subscriptionDraft({ model: 'claude-sonnet-4-5', configDir: 'C:\\claude-config' }),
    );

    expect(payload.config.model).toBe('claude-sonnet-4-5');
    expect(payload.config.configDir).toBe('C:\\claude-config');
    expect(payload.config.models).toEqual([
      {
        id: 'claude-opus-4-5',
        label: 'claude-opus-4-5',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        isDefault: false,
      },
      {
        id: 'claude-sonnet-4-5',
        label: 'claude-sonnet-4-5',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        isDefault: true,
      },
    ]);
  });

  it('uses the preset default model for seeded subscription models', () => {
    const payload = buildProviderPayload(subscriptionDraft());
    const models = payload.config.models as { id: string; isDefault: boolean }[];
    expect(models.find((model) => model.isDefault)?.id).toBe('claude-opus-4-5');
  });

  it('preserves unrelated config keys and removes cleared fields', () => {
    const payload = buildProviderPayload(
      draft({ baseUrl: '', model: '', headers: '', secret: '' }),
      {
        existingConfig: {
          baseUrl: 'http://old',
          model: 'old-model',
          headers: { 'X-Old': 'yes' },
          family: 'openai',
          maxTokens: 8192,
        },
        preset: presetById('openai'),
      },
    );

    expect(payload.config).toMatchObject({ maxTokens: 8192 });
    expect(payload.config).not.toHaveProperty('headers');
    expect(payload.config.model).toBeUndefined();
  });

  it('writes parsed headers into the config', () => {
    const payload = buildProviderPayload(draft({ headers: '{"X-Org":"team"}' }));

    expect(payload.config.headers).toEqual({ 'X-Org': 'team' });
  });

  it('throws when headers are invalid instead of dropping them', () => {
    expect(() => buildProviderPayload(draft({ headers: '[]' }))).toThrow(
      'Headers must be a JSON object.',
    );
  });

  it('adds a typed custom model to the seeded model list', () => {
    const payload = buildProviderPayload(
      draft({ model: 'my-model', models: [{ id: 'gpt-5.1', label: 'gpt-5.1' }] }),
    );
    const models = payload.config.models as { id: string; isDefault: boolean }[];

    expect(models.map((model) => model.id)).toEqual(['gpt-5.1', 'my-model']);
    expect(models.find((model) => model.isDefault)?.id).toBe('my-model');
  });

  it('adds the ACP subcommand for an OpenCode command override', () => {
    const payload = buildProviderPayload(
      subscriptionDraft({
        kind: 'opencode',
        presetId: 'opencode',
        label: 'OpenCode',
        command: 'opencode',
      }),
    );

    expect(payload.config).toMatchObject({
      preset: 'opencode',
      command: 'opencode',
      args: ['acp'],
    });
  });

  it('never stores a secret for a local endpoint', () => {
    const payload = buildProviderPayload(
      draft({
        kind: 'openai-compatible',
        presetId: 'ollama',
        label: 'Ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'qwen3-coder',
        secret: 'unused',
      }),
    );

    expect(payload).not.toHaveProperty('secret');
    expect(payload.config.family).toBe('local');
  });
});

describe('providerDraftFromView', () => {
  it('reads editable fields and never exposes the stored secret', () => {
    const result = providerDraftFromView(providerView);

    expect(result).toEqual({
      kind: 'openai-compatible',
      presetId: 'lmstudio',
      label: 'Local model',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen3-coder',
      models: [
        { id: 'qwen3-coder', label: 'qwen3-coder' },
        { id: 'gpt-oss-20b', label: 'gpt-oss-20b' },
      ],
      headers: '{\n  "X-Org": "team"\n}',
      secret: '',
      configDir: '',
      command: '',
      contextWindow: '',
      maxOutputTokens: '',
      capabilities: { tools: true, vision: false, reasoning: false },
      reasoningEfforts: '',
      reasoningEffort: '',
    });
  });

  it('returns a blank draft for a new provider', () => {
    expect(providerDraftFromView(null)).toEqual({
      kind: 'claude',
      presetId: 'claude',
      label: '',
      baseUrl: '',
      model: '',
      models: [],
      headers: '',
      secret: '',
      configDir: '',
      command: '',
      contextWindow: '',
      maxOutputTokens: '',
      capabilities: { tools: true, vision: false, reasoning: false },
      reasoningEfforts: '',
      reasoningEffort: '',
    });
  });

  it('reads stored advanced options back into the draft', () => {
    const result = providerDraftFromView({
      ...providerView,
      config: {
        ...providerView.config,
        contextWindow: 64_000,
        maxOutputTokens: 8_192,
        capabilities: {
          tools: true,
          vision: true,
          reasoning: true,
          reasoningEfforts: ['low', 'high'],
        },
        reasoningEffort: 'high',
      },
    });

    expect(result.contextWindow).toBe('64000');
    expect(result.maxOutputTokens).toBe('8192');
    expect(result.capabilities).toEqual({ tools: true, vision: true, reasoning: true });
    expect(result.reasoningEfforts).toBe('low, high');
    expect(result.reasoningEffort).toBe('high');
  });

  it('serializes object headers and ignores non-object headers', () => {
    expect(headersToText({ 'X-Org': 'team' })).toBe('{\n  "X-Org": "team"\n}');
    expect(headersToText(['nope'])).toBe('');
    expect(headersToText(undefined)).toBe('');
  });
});

describe('providerDraftFromPreset', () => {
  it('prefills the endpoint and model list from the catalog', () => {
    const preset = presetById('openrouter')!;
    const result = providerDraftFromPreset(preset);

    expect(result.kind).toBe('openai-compatible');
    expect(result.presetId).toBe('openrouter');
    expect(result.label).toBe('OpenRouter');
    expect(result.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(result.model).toBe('openai/gpt-5.1');
    expect(result.models.map((model) => model.id)).toContain('deepseek/deepseek-chat');
    expect(result.secret).toBe('');
  });

  it('leaves subscription endpoints blank', () => {
    const result = providerDraftFromPreset(presetById('claude')!);
    expect(result.baseUrl).toBe('');
    expect(result.secret).toBe('');
    expect(result.kind).toBe('claude');
  });

  it('seeds token limits on every model', () => {
    const openrouter = providerDraftFromPreset(presetById('openrouter')!);
    expect(openrouter.models.every((model) => model.contextWindow === 128_000)).toBe(true);
    expect(openrouter.models.every((model) => model.maxOutputTokens === 8_192)).toBe(true);

    const local = providerDraftFromPreset(presetById('ollama')!);
    expect(local.models.every((model) => model.contextWindow === 32_000)).toBe(true);
    expect(local.models.every((model) => model.maxOutputTokens === 4_096)).toBe(true);
  });

  it('prefills the headers Copilot and Azure require', () => {
    const copilot = providerDraftFromPreset(presetById('copilot')!);
    expect(copilot.baseUrl).toBe('https://api.githubcopilot.com');
    expect(JSON.parse(copilot.headers)).toEqual({
      'Editor-Version': 'vscode/1.99.0',
      'Copilot-Integration-Id': 'vscode-chat',
    });

    const azure = providerDraftFromPreset(presetById('azure-openai')!);
    expect(azure.baseUrl).toBe(
      'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    );
    expect(JSON.parse(azure.headers)).toEqual({ 'api-version': '2024-10-21' });
  });
});

describe('model limit overrides', () => {
  it('accepts seeded limits and cleared rows', () => {
    expect(
      validateModelLimits([
        { id: 'seeded', label: 'seeded', contextWindow: 128_000, maxOutputTokens: 16_384 },
        { id: 'cleared', label: 'cleared', contextWindow: null, maxOutputTokens: null },
      ]),
    ).toEqual({});
  });

  it('rejects a context window that is not a positive whole number', () => {
    const message = 'Context window must be a positive whole number.';
    expect(validateModelLimits([{ id: 'a', label: 'a', contextWindow: 0 }])).toEqual({
      a: { contextWindow: message },
    });
    expect(validateModelLimits([{ id: 'a', label: 'a', contextWindow: -1 }])).toEqual({
      a: { contextWindow: message },
    });
    expect(validateModelLimits([{ id: 'a', label: 'a', contextWindow: 1.5 }])).toEqual({
      a: { contextWindow: message },
    });
  });

  it('rejects a max output larger than the context window', () => {
    expect(
      validateModelLimits([{ id: 'a', label: 'a', contextWindow: 8_000, maxOutputTokens: 9_000 }]),
    ).toEqual({ a: { maxOutputTokens: 'Max output cannot exceed the context window.' } });
    expect(
      validateModelLimits([{ id: 'a', label: 'a', contextWindow: 8_000, maxOutputTokens: 0 }]),
    ).toEqual({ a: { maxOutputTokens: 'Max output must be a positive whole number.' } });
  });

  it('blocks the provider save through validateProviderDraft', () => {
    expect(
      validateProviderDraft(
        draft({ models: [{ id: 'gpt-5.1', label: 'gpt-5.1', contextWindow: 0 }] }),
      ),
    ).toEqual({ models: 'Context window must be a positive whole number.' });
  });

  it('writes an override into the seeded model list and lets null clear it', () => {
    const withWindow = updateModelLimit(draft().models, 'gpt-5.1', 'contextWindow', 64_000);
    const cleared = updateModelLimit(withWindow, 'gpt-5.1', 'maxOutputTokens', null);
    const payload = buildProviderPayload(draft({ models: cleared }));
    const seeds = payload.config.models as Record<string, unknown>[];
    const row = seeds.find((model) => model.id === 'gpt-5.1');

    expect(row).toMatchObject({ contextWindow: 64_000 });
    expect(row).not.toHaveProperty('maxOutputTokens');
    expect(methods['providers.upsert'].params.safeParse(payload).success).toBe(true);
  });

  it('seeds the preset limits on a typed custom model', () => {
    const payload = buildProviderPayload(
      draft({ model: 'my-model', models: [{ id: 'gpt-5.1', label: 'gpt-5.1' }] }),
    );
    const seeds = payload.config.models as Record<string, unknown>[];

    expect(seeds.find((model) => model.id === 'my-model')).toMatchObject({
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    });
  });
});

describe('provider advanced options', () => {
  it('rejects provider token overrides that are not positive whole numbers', () => {
    expect(validateProviderDraft(draft({ contextWindow: '0' }))).toEqual({
      contextWindow: 'Context window must be a positive whole number.',
    });
    expect(validateProviderDraft(draft({ maxOutputTokens: '-4' }))).toEqual({
      maxOutputTokens: 'Max output must be a positive whole number.',
    });
    expect(
      validateProviderDraft(draft({ contextWindow: '8000', maxOutputTokens: '9000' })),
    ).toEqual({ maxOutputTokens: 'Max output cannot exceed the context window.' });
  });

  it('accepts a max output equal to the context window', () => {
    expect(
      validateProviderDraft(draft({ contextWindow: '8000', maxOutputTokens: '8000' })),
    ).toEqual({});
  });

  it('trims and de-duplicates reasoning efforts', () => {
    expect(parseReasoningEfforts(' low, medium , low, high ')).toEqual(['low', 'medium', 'high']);
    expect(parseReasoningEfforts('')).toEqual([]);
    expect(parseReasoningEfforts(' , ')).toEqual([]);
  });

  it('writes the advanced options into the provider config', () => {
    const payload = buildProviderPayload(
      draft({
        contextWindow: '128000',
        maxOutputTokens: '16384',
        capabilities: { tools: true, vision: true, reasoning: true },
        reasoningEfforts: ' low, medium , low, high ',
        reasoningEffort: 'medium',
      }),
    );

    expect(payload.config).toMatchObject({
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      capabilities: {
        tools: true,
        vision: true,
        reasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
      },
      reasoningEffort: 'medium',
    });
    expect(methods['providers.upsert'].params.safeParse(payload).success).toBe(true);
  });

  it('ignores a reasoning effort outside the contract values', () => {
    const payload = buildProviderPayload(draft({ reasoningEffort: 'extreme' }));
    expect(payload.config).not.toHaveProperty('reasoningEffort');
  });

  it('clears stored advanced options when the fields are emptied', () => {
    const payload = buildProviderPayload(draft(), {
      existingConfig: {
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        family: 'openai',
        contextWindow: 64_000,
        maxOutputTokens: 8_192,
        reasoningEffort: 'high',
      },
    });

    expect(payload.config).not.toHaveProperty('contextWindow');
    expect(payload.config).not.toHaveProperty('maxOutputTokens');
    expect(payload.config).not.toHaveProperty('reasoningEffort');
    expect(payload.config.capabilities).toEqual({
      tools: true,
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
    });
  });

  it('carries per-model capabilities and effort through the seed', () => {
    const payload = buildProviderPayload(
      draft({
        models: [
          {
            id: 'gpt-5.1',
            label: 'gpt-5.1',
            contextWindow: 128_000,
            maxOutputTokens: 16_384,
            capabilities: {
              tools: true,
              vision: false,
              reasoning: true,
              reasoningEfforts: ['high'],
            },
            reasoningEffort: 'high',
          },
        ],
      }),
    );
    const seeds = payload.config.models as Record<string, unknown>[];

    expect(seeds[0]).toMatchObject({
      capabilities: { tools: true, vision: false, reasoning: true, reasoningEfforts: ['high'] },
      reasoningEffort: 'high',
    });
  });

  it('seeds capabilities from the preset', () => {
    const openai = providerDraftFromPreset(presetById('openai')!);
    expect(openai.capabilities).toEqual({ tools: true, vision: false, reasoning: true });
    expect(openai.reasoningEfforts).toBe('low, medium, high');
    expect(openai.contextWindow).toBe('128000');
    expect(openai.maxOutputTokens).toBe('16384');

    const together = providerDraftFromPreset(presetById('together')!);
    expect(together.capabilities).toEqual({ tools: true, vision: false, reasoning: false });
    expect(together.reasoningEfforts).toBe('');
  });
});
