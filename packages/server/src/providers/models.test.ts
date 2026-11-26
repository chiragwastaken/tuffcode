import type { ProviderKind } from '@tuffcode/contracts';
import type { ClaudeModelQueryParams } from '@tuffcode/adapters';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import type { ProviderRecord } from '../db/repos/index.js';
import {
  DISCOVERY_TIMEOUT_MS,
  MODEL_CACHE_TTL_MS,
  configuredModels,
  discoverModels,
  mergeModels,
  providerModels,
  type ModelDiscoveryDeps,
} from './models.js';

function seedProvider(
  ctx: TestContext,
  kind: ProviderKind,
  config: Record<string, unknown> = {},
): ProviderRecord {
  const view = ctx.repos.providers.upsert({ id: `prv_${kind}`, kind, label: kind, config });
  const record = ctx.repos.providers.get(view.id);
  if (record === undefined) throw new Error('provider insert did not persist');
  return record;
}

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
): typeof fetch {
  return (input, init) => handler(String(input), init);
}

const resolveTo = (path: string | null) => async () => path;

describe('provider model discovery', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('maps Agent SDK ModelInfo rows and closes the short-lived query', async () => {
    const provider = seedProvider(ctx, 'claude');
    const calls: ClaudeModelQueryParams[] = [];
    let interrupted = false;
    const result = await discoverModels(provider, {
      secret: null,
      resolveCommand: resolveTo('C:/tools/claude.exe'),
      queryFn: (queryParams) => {
        calls.push(queryParams);
        return {
          supportedModels: async () => [
            { value: 'sonnet', displayName: 'Sonnet' },
            { id: 'opus', displayName: 'Opus' },
            { value: 'sonnet', displayName: 'duplicate' },
            { value: '   ', displayName: 'blank' },
          ],
          interrupt: async () => {
            interrupted = true;
          },
        };
      },
    });

    expect(result).toEqual({
      models: [
        {
          id: 'sonnet',
          label: 'Sonnet',
          contextWindow: null,
          maxOutputTokens: null,
          capabilities: {
            tools: true,
            vision: false,
            reasoning: true,
            reasoningEfforts: ['low', 'medium', 'high'],
          },
          reasoningEffort: null,
        },
        {
          id: 'opus',
          label: 'Opus',
          contextWindow: null,
          maxOutputTokens: null,
          capabilities: {
            tools: true,
            vision: false,
            reasoning: true,
            reasoningEfforts: ['low', 'medium', 'high'],
          },
          reasoningEffort: null,
        },
      ],
      source: 'sdk',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      prompt: '',
      options: {
        pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
        permissionMode: 'default',
        persistSession: false,
      },
    });
    expect(calls[0]?.options.abortController.signal.aborted).toBe(true);
    expect(interrupted).toBe(true);
  });

  it('reports a missing claude CLI instead of throwing', async () => {
    const provider = seedProvider(ctx, 'claude');
    await expect(
      discoverModels(provider, { secret: null, resolveCommand: resolveTo(null) }),
    ).resolves.toEqual({ models: [], source: 'sdk', error: 'claude CLI not found' });
  });

  it('surfaces an SDK failure as an error result', async () => {
    const provider = seedProvider(ctx, 'claude');
    const result = await discoverModels(provider, {
      secret: null,
      resolveCommand: resolveTo('C:/tools/claude.exe'),
      queryFn: () => ({
        supportedModels: async () => {
          throw new Error('CLI exited 1');
        },
      }),
    });
    expect(result.models).toEqual([]);
    expect(result.error).toContain('CLI exited 1');
  });

  it('uses the codex app-server list when it answers', async () => {
    const provider = seedProvider(ctx, 'codex', { models: [{ id: 'config', label: 'Config' }] });
    let seenCli = '';
    const listed = {
      id: 'gpt-6',
      label: 'GPT-6',
      contextWindow: 400_000,
      maxOutputTokens: null,
      capabilities: null,
      reasoningEffort: null,
    };
    const result = await discoverModels(provider, {
      secret: null,
      resolveCommand: resolveTo('C:/tools/codex.exe'),
      listCodexModels: async (cliPath, timeoutMs) => {
        seenCli = `${cliPath}:${timeoutMs}`;
        return [listed];
      },
    });
    expect(result).toEqual({ models: [listed], source: 'sdk' });
    expect(seenCli).toBe(`C:/tools/codex.exe:${DISCOVERY_TIMEOUT_MS}`);
  });

  it('falls back to configured codex models when the app-server reports nothing', async () => {
    const provider = seedProvider(ctx, 'codex', {
      models: [{ id: 'local', label: 'Local', contextWindow: 8_192 }],
    });
    await expect(
      discoverModels(provider, {
        secret: null,
        resolveCommand: resolveTo('C:/tools/codex.exe'),
        listCodexModels: async () => null,
      }),
    ).resolves.toEqual({
      models: [
        {
          id: 'local',
          label: 'Local',
          contextWindow: 8_192,
          maxOutputTokens: null,
          capabilities: null,
          reasoningEffort: null,
        },
      ],
      source: 'manual',
    });
  });

  it('lists anthropic models with the key and version headers', async () => {
    const provider = seedProvider(ctx, 'anthropic', { baseUrl: 'https://api.anthropic.com' });
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const result = await discoverModels(provider, {
      secret: 'sk-ant-secret',
      fetchFn: fakeFetch(async (url, init) => {
        seenUrl = url;
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            data: [{ id: 'claude-opus-4-5', display_name: 'Opus 4.5' }],
          }),
          { status: 200 },
        );
      }),
    });

    expect(seenUrl).toBe('https://api.anthropic.com/v1/models');
    expect(seenHeaders['x-api-key']).toBe('sk-ant-secret');
    expect(seenHeaders['anthropic-version']).toBe('2023-06-01');
    expect(result).toEqual({
      models: [
        {
          id: 'claude-opus-4-5',
          label: 'Opus 4.5',
          contextWindow: null,
          maxOutputTokens: null,
          // The endpoint reports an id and a display name only, so capabilities stay unknown.
          capabilities: null,
          reasoningEffort: null,
        },
      ],
      source: 'api',
    });
  });

  it('does not call anthropic without a stored key', async () => {
    const provider = seedProvider(ctx, 'anthropic');
    let called = false;
    const result = await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(async () => {
        called = true;
        return new Response('{}', { status: 200 });
      }),
    });
    expect(called).toBe(false);
    expect(result).toEqual({ models: [], source: 'api', error: 'no API key stored' });
  });

  it('reads a versioned anthropic base URL without doubling the version', async () => {
    const provider = seedProvider(ctx, 'anthropic', { baseUrl: 'https://gateway.test/v1/' });
    let seenUrl = '';
    await discoverModels(provider, {
      secret: 'sk',
      fetchFn: fakeFetch(async (url) => {
        seenUrl = url;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    });
    expect(seenUrl).toBe('https://gateway.test/v1/models');
  });

  it('sends the bearer key for openai-compatible and tolerates a bare array', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://gateway.test/v1/',
      headers: { 'x-title': 'Tuffcode' },
    });
    let seenHeaders: Record<string, string> = {};
    const result = await discoverModels(provider, {
      secret: 'sk-live',
      fetchFn: fakeFetch(async (_url, init) => {
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify([{ id: 'a' }, { id: 'b', name: 'Bee' }]), {
          status: 200,
        });
      }),
    });
    expect(seenHeaders['authorization']).toBe('Bearer sk-live');
    expect(seenHeaders['x-title']).toBe('Tuffcode');
    expect(result.models.map((model) => model.id)).toEqual(['a', 'b']);
    expect(result.models[1]?.label).toBe('Bee');
  });

  it('omits the bearer header for a keyless local endpoint', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'http://127.0.0.1:1234/v1',
    });
    let seenHeaders: Record<string, string> = {};
    await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(async (_url, init) => {
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    });
    expect(seenHeaders['authorization']).toBeUndefined();
  });

  it('returns configured models for acp and opencode', async () => {
    const acp = seedProvider(ctx, 'acp', { models: [{ id: 'agent', label: 'Agent' }] });
    await expect(discoverModels(acp, { secret: null })).resolves.toEqual({
      models: [
        {
          id: 'agent',
          label: 'Agent',
          contextWindow: null,
          maxOutputTokens: null,
          capabilities: null,
          reasoningEffort: null,
        },
      ],
      source: 'manual',
    });

    const opencode = seedProvider(ctx, 'opencode', { models: [{ id: 'oc', label: 'OC' }] });
    const result = await discoverModels(opencode, { secret: null });
    expect(result.models.map((model) => model.id)).toEqual(['oc']);
    expect(result.source).toBe('manual');
  });

  it('serves a fresh cache without calling the endpoint again', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', { baseUrl: 'https://gateway.test' });
    let calls = 0;
    const deps: ModelDiscoveryDeps = {
      secret: null,
      now: () => Date.parse('2026-11-24T00:00:00.000Z'),
      fetchFn: fakeFetch(async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [{ id: 'a' }] }), { status: 200 });
      }),
    };

    const first = await providerModels(ctx.repos, provider, deps);
    expect(first.source).toBe('api');
    expect(calls).toBe(1);
    expect(ctx.repos.providers.modelsRefreshedAt(provider.id)).toBe('2026-11-24T00:00:00.000Z');

    const second = await providerModels(ctx.repos, provider, deps);
    expect(second.source).toBe('cache');
    expect(second.models.map((model) => model.modelId)).toEqual(['a']);
    expect(calls).toBe(1);
  });

  it('rediscovers once the 24h window has passed', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', { baseUrl: 'https://gateway.test' });
    let calls = 0;
    let now = Date.parse('2026-11-24T00:00:00.000Z');
    const deps: ModelDiscoveryDeps = {
      secret: null,
      now: () => now,
      fetchFn: fakeFetch(async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [{ id: `m${calls}` }] }), { status: 200 });
      }),
    };

    await providerModels(ctx.repos, provider, deps);
    now += MODEL_CACHE_TTL_MS + 1;
    const stale = await providerModels(ctx.repos, provider, deps);
    expect(stale.source).toBe('api');
    expect(calls).toBe(2);
    expect(stale.models.map((model) => model.modelId)).toEqual(['m2']);
  });

  it('forces a refresh even inside the cache window', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', { baseUrl: 'https://gateway.test' });
    let calls = 0;
    const deps: ModelDiscoveryDeps = {
      secret: null,
      fetchFn: fakeFetch(async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [{ id: 'a' }] }), { status: 200 });
      }),
    };
    await providerModels(ctx.repos, provider, deps);
    await providerModels(ctx.repos, provider, deps, true);
    expect(calls).toBe(2);
  });

  it('keeps the configured fallback when discovery returns nothing', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://gateway.test',
      models: [{ id: 'manual', label: 'Manual', isDefault: true }],
    });
    ctx.repos.providers.replaceModels(provider.id, [
      { modelId: 'manual', label: 'Manual', contextWindow: null, isDefault: true },
    ]);

    const result = await providerModels(ctx.repos, provider, {
      secret: null,
      fetchFn: fakeFetch(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    });
    expect(result).toEqual({
      models: [
        {
          providerId: provider.id,
          modelId: 'manual',
          label: 'Manual',
          contextWindow: null,
          isDefault: true,
        },
      ],
      source: 'manual',
    });
  });

  it('surfaces an endpoint error without throwing and keeps stored rows', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', { baseUrl: 'https://gateway.test' });
    ctx.repos.providers.replaceModels(provider.id, [
      { modelId: 'kept', label: 'Kept', contextWindow: null, isDefault: false },
    ]);

    const result = await providerModels(ctx.repos, provider, {
      secret: null,
      fetchFn: fakeFetch(async () => new Response('nope', { status: 500 })),
    });
    expect(result.source).toBe('manual');
    expect(result.error).toContain('500');
    expect(result.models.map((model) => model.modelId)).toEqual(['kept']);
  });

  it('preserves the default model across a refresh', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', { baseUrl: 'https://gateway.test' });
    ctx.repos.providers.replaceModels(provider.id, [
      { modelId: 'opus', label: 'Opus', contextWindow: 200_000, isDefault: true },
    ]);

    const result = await providerModels(
      ctx.repos,
      provider,
      {
        secret: null,
        fetchFn: fakeFetch(
          async () =>
            new Response(JSON.stringify({ data: [{ id: 'sonnet', display_name: 'Sonnet' }] }), {
              status: 200,
            }),
        ),
      },
      true,
    );

    expect(result.models.map((model) => model.modelId)).toEqual(['opus', 'sonnet']);
    const kept = result.models.find((model) => model.modelId === 'opus');
    expect(kept).toMatchObject({ isDefault: true, contextWindow: 200_000, label: 'Opus' });
  });

  it('merges thread-referenced models back into the discovered set', () => {
    const existing = [
      {
        providerId: 'prv_x',
        modelId: 'legacy',
        label: 'Legacy',
        contextWindow: null,
        isDefault: false,
      },
    ];
    const merged = mergeModels(
      existing,
      [
        {
          id: 'fresh',
          label: 'Fresh',
          contextWindow: 1_000,
          maxOutputTokens: null,
          capabilities: null,
          reasoningEffort: null,
        },
      ],
      new Set(['legacy']),
    );
    expect(merged.map((model) => model.modelId)).toEqual(['fresh', 'legacy']);
  });

  it('drops stale models no thread references', () => {
    const existing = [
      {
        providerId: 'prv_x',
        modelId: 'gone',
        label: 'Gone',
        contextWindow: null,
        isDefault: false,
      },
    ];
    const merged = mergeModels(
      existing,
      [
        {
          id: 'fresh',
          label: 'Fresh',
          contextWindow: null,
          maxOutputTokens: null,
          capabilities: null,
          reasoningEffort: null,
        },
      ],
      new Set(),
    );
    expect(merged.map((model) => model.modelId)).toEqual(['fresh']);
  });

  it('carries capabilities and reasoning through a merge', () => {
    const freshCapabilities = {
      tools: true,
      vision: true,
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high'],
    };
    const keptCapabilities = {
      tools: true,
      vision: false,
      reasoning: true,
      reasoningEfforts: ['low', 'high'],
    };
    const existing = [
      {
        providerId: 'prv_x',
        modelId: 'default',
        label: 'Default',
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        capabilities: keptCapabilities,
        reasoningEffort: 'medium' as const,
        isDefault: true,
      },
    ];

    const merged = mergeModels(
      existing,
      [
        {
          id: 'fresh',
          label: 'Fresh',
          contextWindow: 200_000,
          maxOutputTokens: 8_192,
          capabilities: freshCapabilities,
          reasoningEffort: 'high' as const,
        },
      ],
      new Set(),
    );

    expect(merged).toEqual([
      {
        modelId: 'fresh',
        label: 'Fresh',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        capabilities: freshCapabilities,
        reasoningEffort: 'high',
        isDefault: false,
      },
      {
        modelId: 'default',
        label: 'Default',
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        capabilities: keptCapabilities,
        reasoningEffort: 'medium',
        isDefault: true,
      },
    ]);
  });

  it('reads an OpenRouter-style entry into limits and capabilities', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://openrouter.test/api/v1',
    });
    const result = await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'vendor/model',
                  name: 'Vendor Model',
                  top_provider: { context_length: 200_000, max_completion_tokens: 16_384 },
                  architecture: { input_modalities: ['text', 'image'] },
                  supported_parameters: ['tools', 'reasoning'],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    });

    expect(result.models).toEqual([
      {
        id: 'vendor/model',
        label: 'Vendor Model',
        contextWindow: 200_000,
        maxOutputTokens: 16_384,
        capabilities: {
          tools: true,
          vision: true,
          reasoning: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
        reasoningEffort: null,
      },
    ]);
  });

  it('leaves capabilities unknown when a bare entry declares nothing', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://gateway.test',
    });
    const result = await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'plain' }] }), { status: 200 }),
      ),
    });

    // The endpoint named a model and said nothing else. Recording `vision: false` here
    // would claim the model cannot see images when nobody ever said so.
    expect(result.models).toEqual([
      {
        id: 'plain',
        label: 'plain',
        contextWindow: null,
        maxOutputTokens: null,
        capabilities: null,
        reasoningEffort: null,
      },
    ]);
  });

  it('leaves capabilities unknown for a bare string entry', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://gateway.test',
    });
    const result = await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(
        async () => new Response(JSON.stringify({ data: ['plain'] }), { status: 200 }),
      ),
    });

    expect(result.models[0]?.capabilities).toBeNull();
  });

  it('records an entry that only declares limits as unknown, not as blind', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://gateway.test',
    });
    const result = await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(
        async () =>
          new Response(
            JSON.stringify({ data: [{ id: 'limited', context_length: 32_000 }] }),
            { status: 200 },
          ),
      ),
    });

    expect(result.models[0]?.contextWindow).toBe(32_000);
    expect(result.models[0]?.capabilities).toBeNull();
  });

  it('prefers an explicit capabilities object over supported_parameters', async () => {
    const provider = seedProvider(ctx, 'openai-compatible', {
      baseUrl: 'https://gateway.test',
    });
    const result = await discoverModels(provider, {
      secret: null,
      fetchFn: fakeFetch(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'declared',
                  capabilities: {
                    tools: false,
                    vision: true,
                    reasoning: false,
                    reasoningEfforts: [],
                  },
                  supported_parameters: ['tools', 'reasoning'],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    });

    expect(result.models[0]?.capabilities).toEqual({
      tools: false,
      vision: true,
      reasoning: false,
      reasoningEfforts: [],
    });
  });

  it('reads model metadata from the provider config seed', () => {
    expect(
      configuredModels({
        models: [
          {
            id: 'a',
            label: 'A',
            contextWindow: 4_096,
            maxOutputTokens: 1_024,
            capabilities: {
              tools: true,
              vision: true,
              reasoning: true,
              reasoningEfforts: ['high'],
            },
            reasoningEffort: 'high',
          },
          { id: 'b', label: 'B' },
          { id: '' },
          'plain',
          42,
        ],
      }),
    ).toEqual([
      {
        id: 'a',
        label: 'A',
        contextWindow: 4_096,
        maxOutputTokens: 1_024,
        capabilities: {
          tools: true,
          vision: true,
          reasoning: true,
          reasoningEfforts: ['high'],
        },
        reasoningEffort: 'high',
      },
      {
        id: 'b',
        label: 'B',
        contextWindow: null,
        maxOutputTokens: null,
        capabilities: null,
        reasoningEffort: null,
      },
    ]);
  });
});
