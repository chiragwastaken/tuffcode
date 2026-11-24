import type { ProviderView } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus, type EventBus } from '../events.js';
import { RpcError } from '../errors.js';
import { createSecretBridge, type Secrets } from '../secrets/bridge.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { createProvidersService, providerSecretKey, type ProvidersService } from './service.js';

interface FakeSecrets extends Secrets {
  calls: { key: string; value: string }[];
  values: Map<string, string>;
}

function fakeSecrets(available = true): FakeSecrets {
  const values = new Map<string, string>();
  const calls: { key: string; value: string }[] = [];
  return {
    available,
    calls,
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      calls.push({ key, value });
      if (value.length === 0) values.delete(key);
      else values.set(key, value);
    },
    dispose: () => undefined,
  };
}

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
): typeof fetch {
  return (input, init) => handler(String(input), init);
}

describe('providers service', () => {
  let ctx: TestContext;
  let bus: EventBus;
  let secrets: FakeSecrets;
  let service: ProvidersService;
  let events: string[];

  function build(overrides: {
    secrets?: Secrets;
    commands?: Record<string, string | null>;
    fetchFn?: typeof fetch;
  } = {}): ProvidersService {
    return createProvidersService({
      repos: ctx.repos,
      bus,
      secrets: overrides.secrets ?? secrets,
      resolveCommand: async (name) => overrides.commands?.[name] ?? null,
      ...(overrides.fetchFn === undefined ? {} : { fetchFn: overrides.fetchFn }),
    });
  }

  beforeEach(() => {
    ctx = createTestContext();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event.type));
    secrets = fakeSecrets();
    service = build();
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('stores only a secret ref and keeps the secret out of every view', async () => {
    const view = await service.upsert({
      id: 'prv_a',
      kind: 'openai-compatible',
      label: 'Local',
      config: { baseUrl: 'https://api.example.com/v1' },
      secret: 'sk-super-secret',
    });

    expect(secrets.calls).toEqual([{ key: providerSecretKey('prv_a'), value: 'sk-super-secret' }]);
    expect(ctx.repos.providers.get('prv_a')?.secretRef).toBe(providerSecretKey('prv_a'));
    expect(view.hasSecret).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-super-secret');
    expect(events).toContain('providers.updated');
  });

  it('clears the ref on an empty secret and keeps it when the secret is absent', async () => {
    await service.upsert({
      id: 'prv_a',
      kind: 'claude',
      label: 'Claude',
      config: {},
      secret: 'sk-first',
    });
    expect(ctx.repos.providers.get('prv_a')?.secretRef).toBe('provider:prv_a');

    const kept = await service.upsert({
      id: 'prv_a',
      kind: 'claude',
      label: 'Claude renamed',
      config: {},
    });
    expect(kept.hasSecret).toBe(true);
    expect(ctx.repos.providers.get('prv_a')?.secretRef).toBe('provider:prv_a');

    const cleared = await service.upsert({
      id: 'prv_a',
      kind: 'claude',
      label: 'Claude',
      config: {},
      secret: '',
    });
    expect(cleared.hasSecret).toBe(false);
    expect(ctx.repos.providers.get('prv_a')?.secretRef).toBeNull();
    expect(secrets.values.has('provider:prv_a')).toBe(false);
  });

  it('fails as internal and writes no row when no bridge can store a secret', async () => {
    const unavailable = build({ secrets: createSecretBridge(undefined) });
    await expect(
      unavailable.upsert({
        id: 'prv_offline',
        kind: 'claude',
        label: 'Claude',
        config: {},
        secret: 'sk-nope',
      }),
    ).rejects.toMatchObject({ code: 'internal', message: 'secret storage unavailable' });
    expect(ctx.repos.providers.get('prv_offline')).toBeUndefined();
  });

  it('replaces seeded models and lists them per provider', async () => {
    const view = await service.upsert({
      id: 'prv_a',
      kind: 'claude',
      label: 'Claude',
      config: {
        models: [
          { id: 'opus', label: 'Opus', contextWindow: 200_000, isDefault: true },
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
    });
    expect(service.listModels(view.id).map((model) => model.modelId)).toEqual(['opus', 'sonnet']);
    expect(service.listModels(view.id)[0]).toMatchObject({ isDefault: true, contextWindow: 200_000 });

    await service.upsert({
      id: 'prv_a',
      kind: 'claude',
      label: 'Claude',
      config: { models: [{ id: 'haiku', label: 'Haiku' }] },
    });
    expect(service.listModels('prv_a').map((model) => model.modelId)).toEqual(['haiku']);

    expect(() => service.listModels('prv_missing')).toThrow('provider not found');
  });

  it('reports found and missing CLI commands with the install hint', async () => {
    const cli = build({
      commands: {
        claude: 'C:/tools/claude.exe',
        opencode: 'C:/tools/opencode.exe',
      },
    });
    await cli.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });
    await expect(cli.test('prv_claude')).resolves.toEqual({
      ok: true,
      detail: 'C:/tools/claude.exe',
    });

    await cli.upsert({ id: 'prv_codex', kind: 'codex', label: 'Codex', config: {} });
    const codex = await cli.test('prv_codex');
    expect(codex.ok).toBe(false);
    expect(codex.detail).toContain('npm install -g @openai/codex');

    await cli.upsert({ id: 'prv_acp', kind: 'acp', label: 'ACP', config: {} });
    const acp = await cli.test('prv_acp');
    expect(acp.ok).toBe(false);
    expect(acp.detail).toContain('ACP');

    await cli.upsert({ id: 'prv_opencode', kind: 'opencode', label: 'OpenCode', config: {} });
    await expect(cli.test('prv_opencode')).resolves.toEqual({
      ok: true,
      detail: 'C:/tools/opencode.exe',
    });

    await expect(cli.test('prv_missing')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('checks an openai-compatible endpoint with the bearer secret and never leaks it', async () => {
    let seenHeaders: Record<string, string> = {};
    let seenUrl = '';
    const openai = build({
      commands: {},
      fetchFn: fakeFetch(async (url, init) => {
        seenUrl = url;
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 });
      }),
    });
    await openai.upsert({
      id: 'prv_api',
      kind: 'openai-compatible',
      label: 'API',
      config: { baseUrl: 'https://api.example.com/v1/', headers: { 'x-title': 'Tuffcode' } },
      secret: 'sk-live-secret',
    });

    const result = await openai.test('prv_api');
    expect(seenUrl).toBe('https://api.example.com/v1/models');
    expect(seenHeaders['authorization']).toBe('Bearer sk-live-secret');
    expect(seenHeaders['x-title']).toBe('Tuffcode');
    expect(result).toEqual({ ok: true, detail: '2 models available' });
    expect(result.detail).not.toContain('sk-live-secret');

    const unauthorized = build({
      fetchFn: fakeFetch(async () => new Response('nope', { status: 401 })),
    });
    const denied = await unauthorized.test('prv_api');
    expect(denied.ok).toBe(false);
    expect(denied.detail).toContain('401');
    expect(denied.detail).not.toContain('sk-live-secret');

    const offline = build({
      fetchFn: fakeFetch(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1');
      }),
    });
    const failed = await offline.test('prv_api');
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain('ECONNREFUSED');
    expect(failed.detail).not.toContain('sk-live-secret');
  });

  it('clears the secret best effort and broadcasts the removal', async () => {
    await service.upsert({
      id: 'prv_a',
      kind: 'claude',
      label: 'Claude',
      config: {},
      secret: 'sk-first',
    });
    events.length = 0;
    await service.remove('prv_a');
    expect(secrets.calls.at(-1)).toEqual({ key: 'provider:prv_a', value: '' });
    expect(ctx.repos.providers.get('prv_a')).toBeUndefined();
    expect(events).toContain('providers.updated');
  });

  it('rejects an invalid config before writing anything', async () => {
    await expect(
      service.upsert({
        id: 'prv_bad',
        kind: 'openai-compatible',
        label: 'Bad',
        config: {},
      }),
    ).rejects.toMatchObject({ code: 'bad-request' });
    expect(ctx.repos.providers.get('prv_bad')).toBeUndefined();
  });

  it('returns the stored provider views from list', async () => {
    const view = await service.upsert({ id: 'prv_a', kind: 'claude', label: 'Claude', config: {} });
    expect(service.list()).toEqual<ProviderView[]>([view]);
  });

  it('rejects an unknown provider in test as not-found', async () => {
    await expect(service.test('prv_none')).rejects.toBeInstanceOf(RpcError);
  });
});
