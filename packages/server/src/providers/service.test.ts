import type { ProviderView } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type EventBus } from '../events.js';
import { RpcError } from '../errors.js';
import { createSecretBridge, type Secrets } from '../secrets/bridge.js';
import { createTestContext, type TestContext } from '../test-support.js';
import type { CommandResult, RunCommand } from './command.js';
import { createProviderHandlers } from './rpc.js';
import {
  createProvidersService,
  providerSecretKey,
  type ProviderDiscoveryOverrides,
  type ProvidersService,
} from './service.js';

function statusCommand(result: CommandResult): RunCommand {
  return async () => result;
}

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

  function build(
    overrides: {
      secrets?: Secrets;
      commands?: Record<string, string | null>;
      fetchFn?: typeof fetch;
      runCommand?: RunCommand;
      discovery?: ProviderDiscoveryOverrides;
    } = {},
  ): ProvidersService {
    return createProvidersService({
      repos: ctx.repos,
      bus,
      secrets: overrides.secrets ?? secrets,
      resolveCommand: async (name) => overrides.commands?.[name] ?? null,
      fetchFn: overrides.fetchFn ?? fakeFetch(async () => new Response('{}', { status: 404 })),
      ...(overrides.runCommand === undefined ? {} : { runCommand: overrides.runCommand }),
      discovery: overrides.discovery ?? {
        queryFn: () => ({ supportedModels: async () => [] }),
        listCodexModels: async () => null,
      },
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
    expect(service.listModels(view.id)[0]).toMatchObject({
      isDefault: true,
      contextWindow: 200_000,
    });

    const rich = await service.upsert({
      id: 'prv_rich',
      kind: 'claude',
      label: 'Claude',
      config: {
        models: [
          {
            id: 'thinking',
            label: 'Thinking',
            contextWindow: 200_000,
            maxOutputTokens: 64_000,
            capabilities: {
              tools: true,
              vision: true,
              reasoning: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
            reasoningEffort: 'medium',
          },
        ],
      },
    });
    expect(service.listModels(rich.id)[0]).toMatchObject({
      modelId: 'thinking',
      maxOutputTokens: 64_000,
      capabilities: {
        tools: true,
        vision: true,
        reasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
      },
      reasoningEffort: 'medium',
    });

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
      runCommand: statusCommand({
        code: 0,
        stdout: '{"loggedIn":true,"authMethod":"oauth_token"}',
        stderr: '',
      }),
    });
    await cli.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });
    await expect(cli.test('prv_claude')).resolves.toEqual({
      ok: true,
      detail: 'signed in (oauth_token)',
      signedIn: true,
      cliPath: 'C:/tools/claude.exe',
    });

    await cli.upsert({ id: 'prv_codex', kind: 'codex', label: 'Codex', config: {} });
    const codex = await cli.test('prv_codex');
    expect(codex).toMatchObject({ ok: false, signedIn: false });
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

  it('parses claude auth status for a fake CLI', async () => {
    const invocations: { file: string; args: string[] }[] = [];
    const claude = build({
      commands: { claude: 'C:/tools/claude.exe' },
      runCommand: async (file, args) => {
        invocations.push({ file, args });
        return { code: 1, stdout: '{"loggedIn":false}', stderr: '' };
      },
    });
    await claude.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });

    await expect(claude.test('prv_claude')).resolves.toEqual({
      ok: false,
      detail: 'not signed in',
      signedIn: false,
      cliPath: 'C:/tools/claude.exe',
    });
    expect(invocations).toEqual([
      { file: 'C:/tools/claude.exe', args: ['auth', 'status', '--json'] },
    ]);

    const garbage = build({
      commands: { claude: 'C:/tools/claude.exe' },
      runCommand: statusCommand({ code: 0, stdout: 'not json', stderr: '' }),
    });
    await expect(garbage.test('prv_claude')).resolves.toMatchObject({
      ok: false,
      signedIn: false,
      detail: 'claude auth status did not report JSON',
    });
  });

  it('parses codex login status from the CLI output and exit code', async () => {
    const signedIn = build({
      commands: { codex: 'C:/tools/codex.exe' },
      runCommand: statusCommand({ code: 0, stdout: '', stderr: 'Logged in using ChatGPT' }),
    });
    await signedIn.upsert({ id: 'prv_codex', kind: 'codex', label: 'Codex', config: {} });
    await expect(signedIn.test('prv_codex')).resolves.toEqual({
      ok: true,
      detail: 'Logged in using ChatGPT',
      signedIn: true,
      cliPath: 'C:/tools/codex.exe',
    });

    const signedOut = build({
      commands: { codex: 'C:/tools/codex.exe' },
      runCommand: statusCommand({ code: 1, stdout: '', stderr: 'Not logged in' }),
    });
    await expect(signedOut.test('prv_codex')).resolves.toEqual({
      ok: false,
      detail: 'Not logged in',
      signedIn: false,
      cliPath: 'C:/tools/codex.exe',
    });

    const apiKey = build({
      commands: { codex: 'C:/tools/codex.exe' },
      runCommand: statusCommand({
        code: 0,
        stdout: '',
        stderr: 'API key configured - sk-abcd...wxyz',
      }),
    });
    await expect(apiKey.test('prv_codex')).resolves.toMatchObject({
      ok: true,
      signedIn: true,
      detail: 'signed in with an API key',
    });
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
    expect(result).toEqual({ ok: true, detail: '2 models available', models: ['a', 'b'] });
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

  it('probes the anthropic models endpoint with the stored API key', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const anthropic = build({
      fetchFn: fakeFetch(async (url, init) => {
        seenUrl = url;
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({ data: [{ id: 'claude-opus-4-5' }, { id: 'claude-sonnet-4-5' }] }),
          { status: 200 },
        );
      }),
    });
    await anthropic.upsert({
      id: 'prv_anthropic',
      kind: 'anthropic',
      label: 'Anthropic API',
      config: { model: 'claude-opus-4-5', headers: { 'x-title': 'Tuffcode' } },
      secret: 'sk-ant-live',
    });

    await expect(anthropic.test('prv_anthropic')).resolves.toEqual({
      ok: true,
      detail: '2 models available',
      models: ['claude-opus-4-5', 'claude-sonnet-4-5'],
    });
    expect(seenUrl).toBe('https://api.anthropic.com/v1/models');
    expect(seenHeaders['x-api-key']).toBe('sk-ant-live');
    expect(seenHeaders['anthropic-version']).toBe('2023-06-01');
    expect(seenHeaders['x-title']).toBe('Tuffcode');
    expect(seenHeaders['authorization']).toBeUndefined();
  });

  it('keeps a custom anthropic base URL and reports HTTP failures', async () => {
    let seenUrl = '';
    const anthropic = build({
      fetchFn: fakeFetch(async (url) => {
        seenUrl = url;
        return new Response('nope', { status: 401 });
      }),
    });
    await anthropic.upsert({
      id: 'prv_anthropic',
      kind: 'anthropic',
      label: 'Anthropic',
      config: { baseUrl: 'https://proxy.example.com/anthropic/v1/' },
      secret: 'sk-ant-live',
    });

    const result = await anthropic.test('prv_anthropic');
    expect(seenUrl).toBe('https://proxy.example.com/anthropic/v1/models');
    expect(result).toEqual({ ok: false, detail: 'endpoint returned HTTP 401' });
  });

  it('requires an API key for an anthropic provider', async () => {
    await expect(
      service.upsert({
        id: 'prv_anthropic',
        kind: 'anthropic',
        label: 'Anthropic',
        config: {},
      }),
    ).rejects.toMatchObject({
      code: 'bad-request',
      message: 'anthropic providers require an API key',
    });
    expect(ctx.repos.providers.get('prv_anthropic')).toBeUndefined();

    const stored = await service.upsert({
      id: 'prv_anthropic',
      kind: 'anthropic',
      label: 'Anthropic',
      config: {},
      secret: 'sk-ant-live',
    });
    expect(stored.hasSecret).toBe(true);

    const renamed = await service.upsert({
      id: 'prv_anthropic',
      kind: 'anthropic',
      label: 'Anthropic renamed',
      config: {},
    });
    expect(renamed.hasSecret).toBe(true);

    await expect(
      service.upsert({
        id: 'prv_anthropic',
        kind: 'anthropic',
        label: 'Anthropic',
        config: {},
        secret: '',
      }),
    ).rejects.toMatchObject({ code: 'bad-request' });
    expect(ctx.repos.providers.get('prv_anthropic')?.secretRef).toBe('provider:prv_anthropic');
  });

  it('discovers models after a save without delaying the save', async () => {
    const queried: string[] = [];
    const discovered = build({
      commands: { claude: 'C:/tools/claude.exe' },
      discovery: {
        queryFn: (params) => {
          queried.push(params.options.pathToClaudeCodeExecutable);
          return {
            supportedModels: async () => [{ value: 'sonnet', displayName: 'Sonnet' }],
          };
        },
      },
    });

    const view = await discovered.upsert({
      id: 'prv_claude',
      kind: 'claude',
      label: 'Claude',
      config: {},
    });
    expect(queried).toEqual([]);

    await vi.waitFor(() => {
      expect(ctx.repos.providers.listModels(view.id).map((model) => model.modelId)).toEqual([
        'sonnet',
      ]);
    });
    expect(queried).toEqual(['C:/tools/claude.exe']);
  });

  it('reports a failed background discovery as a server warning', async () => {
    const warnings: string[] = [];
    bus.subscribe((event) => {
      if (event.type === 'server.warning') warnings.push(event.payload.message);
    });
    const broken = build({
      commands: { claude: 'C:/tools/claude.exe' },
      discovery: {
        queryFn: () => ({
          supportedModels: async () => {
            throw new Error('not signed in');
          },
        }),
      },
    });

    const view = await broken.upsert({
      id: 'prv_claude',
      kind: 'claude',
      label: 'Claude',
      config: {},
    });
    await vi.waitFor(() => expect(warnings).toHaveLength(1));
    expect(warnings[0]).toContain('Claude');
    expect(warnings[0]).toContain('not signed in');
    expect(ctx.repos.providers.get(view.id)).toBeDefined();
  });

  it('answers providers.models through the rpc handler and honours refresh', async () => {
    const handlers = createProviderHandlers({ providers: service });
    const handler = handlers.get('providers.models');
    expect(handler).toBeDefined();

    await service.upsert({
      id: 'prv_acp',
      kind: 'acp',
      label: 'ACP',
      config: { models: [{ id: 'agent', label: 'Agent' }] },
    });

    const result = await service.models('prv_acp', true);
    expect(result.source).toBe('manual');
    expect(result.models.map((model) => model.modelId)).toEqual(['agent']);
    await expect(handler?.({ providerId: 'prv_acp', refresh: true })).resolves.toMatchObject({
      source: 'manual',
    });
    await expect(handler?.({ providerId: 'prv_missing' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});
