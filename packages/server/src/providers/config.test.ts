import { describe, expect, it } from 'vitest';
import { RpcError } from '../errors.js';
import { validateProviderConfig } from './config.js';

function expectBadRequest(fn: () => unknown, path: string): void {
  try {
    fn();
    throw new Error('expected a bad-request error');
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('bad-request');
    expect((error as RpcError).message).toContain(path);
  }
}

describe('provider config validation', () => {
  it('accepts valid config for every kind and preserves unknown keys', () => {
    expect(
      validateProviderConfig('claude', {
        pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
        futureKey: { keep: true },
      }),
    ).toEqual({ pathToClaudeCodeExecutable: 'C:/tools/claude.exe', futureKey: { keep: true } });

    expect(validateProviderConfig('codex', { command: 'codex', model: 'gpt-5', extra: 1 })).toEqual({
      command: 'codex',
      model: 'gpt-5',
      extra: 1,
    });

    expect(
      validateProviderConfig('acp', {
        command: ['agy', 'acp'],
        args: ['--verbose'],
        env: { ACP_DEBUG: '1' },
        family: 'anthropic',
      }),
    ).toEqual({
      command: ['agy', 'acp'],
      args: ['--verbose'],
      env: { ACP_DEBUG: '1' },
      family: 'anthropic',
    });

    expect(validateProviderConfig('opencode', {})).toEqual({ command: 'opencode', args: ['acp'] });
    expect(validateProviderConfig('opencode', { command: 'custom-opencode' })).toEqual({
      command: 'custom-opencode',
    });

    expect(
      validateProviderConfig('openai-compatible', {
        baseUrl: 'https://api.example.com/v1',
        headers: { 'x-title': 'Tuffcode' },
        family: 'openai',
        maxTokens: 4096,
        temperature: 0.7,
      }),
    ).toEqual({
      baseUrl: 'https://api.example.com/v1',
      headers: { 'x-title': 'Tuffcode' },
      family: 'openai',
      maxTokens: 4096,
      temperature: 0.7,
    });

    expect(validateProviderConfig('anthropic', {})).toEqual({
      baseUrl: 'https://api.anthropic.com',
    });
    expect(
      validateProviderConfig('anthropic', {
        baseUrl: 'https://proxy.example.com/anthropic/',
        model: 'claude-opus-4-5',
        headers: { 'x-title': 'Tuffcode' },
      }),
    ).toEqual({
      baseUrl: 'https://proxy.example.com/anthropic/',
      model: 'claude-opus-4-5',
      headers: { 'x-title': 'Tuffcode' },
    });
  });

  it('accepts a models seed on any kind', () => {
    expect(
      validateProviderConfig('claude', {
        models: [{ id: 'claude-opus', label: 'Opus', contextWindow: 200_000, isDefault: true }],
      }),
    ).toEqual({
      models: [{ id: 'claude-opus', label: 'Opus', contextWindow: 200_000, isDefault: true }],
    });
  });

  it('accepts model metadata, including null limits and unknown capabilities', () => {
    const models = [
      {
        id: 'openrouter/model',
        label: 'Router',
        maxOutputTokens: 16_384,
        capabilities: {
          tools: true,
          vision: true,
          reasoning: true,
          reasoningEfforts: ['low', 'high'],
        },
        reasoningEffort: 'high',
      },
      { id: 'unknown', label: 'Unknown', maxOutputTokens: null, capabilities: null },
      { id: 'plain', label: 'Plain', reasoningEffort: null },
    ];

    expect(
      validateProviderConfig('openai-compatible', { baseUrl: 'https://openrouter.test', models }),
    ).toEqual({ baseUrl: 'https://openrouter.test', models });
  });

  it('rejects a missing or non-http baseUrl', () => {
    expectBadRequest(() => validateProviderConfig('openai-compatible', {}), 'baseUrl');
    expectBadRequest(
      () => validateProviderConfig('openai-compatible', { baseUrl: 'api.example.com' }),
      'baseUrl',
    );
    expectBadRequest(
      () => validateProviderConfig('openai-compatible', { baseUrl: 'ftp://example.com' }),
      'baseUrl',
    );
    expectBadRequest(
      () => validateProviderConfig('anthropic', { baseUrl: 'api.anthropic.com' }),
      'baseUrl',
    );
    expectBadRequest(
      () => validateProviderConfig('anthropic', { baseUrl: 'ftp://example.com' }),
      'baseUrl',
    );
  });

  it('rejects bad headers, a negative maxTokens, and an out of range temperature', () => {
    expectBadRequest(
      () =>
        validateProviderConfig('openai-compatible', {
          baseUrl: 'https://api.example.com',
          headers: { 'x-title': 3 },
        }),
      'headers.x-title',
    );
    expectBadRequest(
      () => validateProviderConfig('anthropic', { headers: { 'x-title': 3 } }),
      'headers.x-title',
    );
    expectBadRequest(() => validateProviderConfig('anthropic', { model: '   ' }), 'model');
    expectBadRequest(
      () =>
        validateProviderConfig('openai-compatible', {
          baseUrl: 'https://api.example.com',
          maxTokens: -1,
        }),
      'maxTokens',
    );
    expectBadRequest(
      () =>
        validateProviderConfig('openai-compatible', {
          baseUrl: 'https://api.example.com',
          temperature: 2.5,
        }),
      'temperature',
    );
    expectBadRequest(
      () =>
        validateProviderConfig('openai-compatible', {
          baseUrl: 'https://api.example.com',
          temperature: Number.POSITIVE_INFINITY,
        }),
      'temperature',
    );
  });

  it('rejects an empty command and non-string env values', () => {
    expectBadRequest(() => validateProviderConfig('codex', { command: '   ' }), 'command');
    expectBadRequest(() => validateProviderConfig('acp', { command: [] }), 'command');
    expectBadRequest(
      () => validateProviderConfig('acp', { command: 'agy', env: { TOKEN: 7 } }),
      'env.TOKEN',
    );
    expectBadRequest(
      () => validateProviderConfig('acp', { command: 'agy', args: ['ok', 2] }),
      'args',
    );
  });

  it('rejects malformed model seeds', () => {
    expectBadRequest(
      () => validateProviderConfig('claude', { models: [{ label: 'Opus' }] }),
      'models[0].id',
    );
    expectBadRequest(
      () => validateProviderConfig('claude', { models: [{ id: 'x', label: 'X', contextWindow: 0 }] }),
      'models[0].contextWindow',
    );
    expectBadRequest(
      () =>
        validateProviderConfig('claude', {
          models: [
            { id: 'a', label: 'A', isDefault: true },
            { id: 'b', label: 'B', isDefault: true },
          ],
        }),
      'models',
    );
  });

  it('rejects malformed model metadata', () => {
    expectBadRequest(
      () =>
        validateProviderConfig('claude', {
          models: [{ id: 'x', label: 'X', maxOutputTokens: 1.5 }],
        }),
      'models[0].maxOutputTokens',
    );
    expectBadRequest(
      () =>
        validateProviderConfig('claude', {
          models: [{ id: 'x', label: 'X', maxOutputTokens: 0 }],
        }),
      'models[0].maxOutputTokens',
    );
    expectBadRequest(
      () =>
        validateProviderConfig('claude', {
          models: [
            {
              id: 'x',
              label: 'X',
              capabilities: {
                tools: true,
                vision: false,
                reasoning: 'yes',
                reasoningEfforts: [],
              },
            },
          ],
        }),
      'models[0].capabilities.reasoning',
    );
    expectBadRequest(
      () =>
        validateProviderConfig('claude', {
          models: [{ id: 'x', label: 'X', reasoningEffort: 'extreme' }],
        }),
      'models[0].reasoningEffort',
    );
  });

  it('rejects a non-object config', () => {
    expect(() => validateProviderConfig('claude', [] as unknown as Record<string, unknown>)).toThrow(
      'config must be an object',
    );
  });
});
