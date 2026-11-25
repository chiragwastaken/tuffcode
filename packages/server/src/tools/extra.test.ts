import {
  DEFAULT_SETTINGS,
  ProviderConfigSchema,
  type McpTool,
  type ProviderView,
  type Settings,
} from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemorySearchInput, MemorySearchResult } from '../brain/search.js';
import type { UpsertBrainInput, UpsertMcpServerInput } from '../db/repos/index.js';
import type { McpService } from '../mcp/service.js';
import type { ProvidersService, ProvidersUpsertInput } from '../providers/service.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { createExtraTools, type ExtraToolBrain } from './extra.js';

const ISO = '2026-11-24T10:00:00.000Z';

interface HarnessOptions {
  settings?: Partial<Settings>;
  searchEntries?: MemorySearchResult['entries'];
  mcpTools?: McpTool[];
  callResult?: string;
}

interface Harness {
  run(name: string, args: Record<string, unknown>, cwd?: string): Promise<string>;
  providerCalls: ProvidersUpsertInput[];
  mcpCalls: UpsertMcpServerInput[];
  brainAdds: UpsertBrainInput[];
  searches: MemorySearchInput[];
  callCalls: { id: string; tool: string; args: Record<string, unknown> }[];
}

describe('extra tools', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  function harness(options: HarnessOptions = {}): Harness {
    const providerCalls: ProvidersUpsertInput[] = [];
    const mcpCalls: UpsertMcpServerInput[] = [];
    const brainAdds: UpsertBrainInput[] = [];
    const searches: MemorySearchInput[] = [];
    const callCalls: { id: string; tool: string; args: Record<string, unknown> }[] = [];
    const settings: Settings = { ...DEFAULT_SETTINGS, ...options.settings };

    const providers: ProvidersService = {
      list: () => ctx.repos.providers.list(),
      upsert: async (input): Promise<ProviderView> => {
        providerCalls.push(input);
        return {
          id: input.id ?? 'prv_new',
          kind: input.kind,
          label: input.label,
          config: ProviderConfigSchema.parse(input.config),
          enabled: true,
          hasSecret: input.secret !== undefined && input.secret.length > 0,
          createdAt: ISO,
          updatedAt: ISO,
        };
      },
      remove: async () => undefined,
      test: async () => ({ ok: false, detail: 'not implemented' }),
      listModels: () => [],
      models: async () => ({ models: [], source: 'manual' }),
      login: async () => ({ loginId: 'login' }),
      cancelLogin: async () => undefined,
    };

    const mcp: McpService = {
      list: () => ctx.repos.mcp.list(),
      upsert: (input) => {
        mcpCalls.push(input);
        return ctx.repos.mcp.upsert(input);
      },
      remove: (id) => ctx.repos.mcp.remove(id),
      test: async () => ({ ok: true, detail: 'Connected', tools: [] }),
      listTools: async () => options.mcpTools ?? [],
      callTool: async (id, tool, args) => {
        callCalls.push({ id, tool, args });
        return options.callResult ?? 'called';
      },
    };

    const brain: ExtraToolBrain = {
      search: (input) => {
        searches.push(input);
        return { entries: options.searchEntries ?? [] };
      },
      add: (input) => {
        brainAdds.push(input);
        return ctx.repos.brain.upsert(input);
      },
    };

    const tools = createExtraTools({ repos: ctx.repos, settings: () => settings, providers, mcp, brain });
    return {
      run: (name, args, cwd = 'C:/work') => tools.run(name, args, { cwd }),
      providerCalls,
      mcpCalls,
      brainAdds,
      searches,
      callCalls,
    };
  }

  it('lists enabled servers with one-line tool descriptions and notes disabled ones', async () => {
    ctx.repos.mcp.upsert({ label: 'files', command: 'fake-mcp' });
    ctx.repos.mcp.upsert({ label: 'legacy', command: 'fake-mcp', enabled: false });
    const tools: McpTool[] = [
      { name: 'read_file', description: 'Read a file\nsecond line', inputSchema: {} },
      { name: 'list_dir', description: '', inputSchema: {} },
    ];
    const h = harness({ mcpTools: tools });

    const text = await h.run('mcp', { action: 'list' }, 'C:/work');

    expect(text).toContain('files (');
    expect(text).toContain('  read_file: Read a file');
    expect(text).toContain('  list_dir');
    expect(text).not.toContain('second line');
    expect(text).toContain('legacy (');
    expect(text).toContain('disabled');
  });

  it('parses JSON tool arguments for mcp call', async () => {
    const h = harness({ callResult: 'file body' });

    const text = await h.run(
      'mcp',
      { action: 'call', server: 'mcp_1', tool: 'read_file', arguments: '{"path":"src"}' },
      'C:/work',
    );

    expect(text).toBe('file body');
    expect(h.callCalls).toEqual([{ id: 'mcp_1', tool: 'read_file', args: { path: 'src' } }]);
  });

  it('returns an error string for malformed tool arguments', async () => {
    const h = harness();

    const text = await h.run(
      'mcp',
      { action: 'call', server: 'mcp_1', tool: 'read_file', arguments: '{oops' },
      'C:/work',
    );

    expect(text).toContain('arguments must be valid JSON');
    expect(h.callCalls).toEqual([]);
  });

  it('returns ranked memory search lines capped at eight', async () => {
    const entries = Array.from({ length: 10 }, (_value, index) => ({
      id: `brn_${index}`,
      kind: 'memory' as const,
      text: `fact ${index}`,
      score: 1 - index / 20,
      reason: 'matched "pnpm"',
    }));
    const h = harness({ searchEntries: entries });

    const text = await h.run('memory', { action: 'search', query: 'pnpm' }, 'C:/work');

    expect(text.split('\n')).toHaveLength(8);
    expect(text.split('\n')[0]).toBe('memory fact 0 (1.00, matched "pnpm")');
    expect(h.searches[0]).toMatchObject({ query: 'pnpm', limit: 8 });
  });

  it('says so when memory search finds nothing', async () => {
    const h = harness();

    await expect(h.run('memory', { action: 'search', query: 'nothing' }, 'C:/work')).resolves.toBe(
      'No matching memory entries.',
    );
  });

  it('adds memory with defaults, parsed tags and a clamped importance', async () => {
    const h = harness();

    const id = await h.run(
      'memory',
      { action: 'add', text: 'ship small', tags: 'build, windows ,, ', importance: 5 },
      'C:/work',
    );

    expect(id).toMatch(/^brn_/);
    expect(h.brainAdds[0]).toMatchObject({
      kind: 'memory',
      text: 'ship small',
      tags: 'build,windows',
      importance: 1,
      projectId: null,
      scope: 'global',
    });
  });

  it('clamps a negative importance to zero', async () => {
    const h = harness();

    await h.run('memory', { action: 'add', text: 'low value', importance: -3 }, 'C:/work');

    expect(h.brainAdds[0]?.importance).toBe(0);
  });

  it('scopes memory to the thread worktree, then the project path', async () => {
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: 'C:/work/alpha',
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'alpha thread',
      providerId: 'prv_x',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: 'C:/work/alpha-wt',
      branch: 'tuffcode/thr_a',
      baseBranch: 'main',
      createdAt: ISO,
      updatedAt: ISO,
    });
    const h = harness();

    await h.run('memory', { action: 'search', query: 'pnpm' }, 'C:/work/alpha-wt');
    expect(h.searches[0]?.projectId).toBe('prj_a');

    await h.run('memory', { action: 'search', query: 'pnpm' }, 'C:/work/alpha');
    expect(h.searches[1]?.projectId).toBe('prj_a');

    await h.run('memory', { action: 'search', query: 'pnpm' }, 'C:/elsewhere');
    expect(h.searches[2]?.projectId).toBeUndefined();
  });

  it('refuses memory actions while the brain kill switch is off', async () => {
    const h = harness({ settings: { brainEnabled: false } });

    const added = await h.run('memory', { action: 'add', text: 'ignored' }, 'C:/work');
    const searched = await h.run('memory', { action: 'search', query: 'ignored' }, 'C:/work');

    expect(added).toBe('brain is disabled in settings');
    expect(searched).toBe('brain is disabled in settings');
    expect(h.brainAdds).toEqual([]);
    expect(h.searches).toEqual([]);
  });

  it('adds a provider with the documented config fields and no secret', async () => {
    const h = harness();

    const id = await h.run(
      'config',
      {
        action: 'provider.add',
        kind: 'openai-compatible',
        label: 'Local',
        baseUrl: 'http://localhost:1234/v1',
        model: 'qwen',
        contextWindow: '128000',
        maxOutputTokens: 8192,
        capabilities: '{"tools":true}',
        reasoning: 'high',
      },
      'C:/work',
    );

    expect(id).toBe('prv_new');
    expect(h.providerCalls[0]).toMatchObject({
      kind: 'openai-compatible',
      label: 'Local',
      config: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'qwen',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: { tools: true, vision: false, reasoning: false, reasoningEfforts: [] },
        reasoningEffort: 'high',
      },
    });
    expect(h.providerCalls[0]?.secret).toBeUndefined();
  });

  it('ignores an apiKey argument and never reaches the secret path', async () => {
    const h = harness();

    const id = await h.run(
      'config',
      {
        action: 'provider.add',
        kind: 'openai-compatible',
        label: 'Remote',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'sk-should-not-be-stored',
      },
      'C:/work',
    );

    expect(id).toBe('prv_new');
    expect(h.providerCalls[0]?.secret).toBeUndefined();
    expect(h.providerCalls[0]?.config).toEqual({ baseUrl: 'https://api.example.test/v1' });
    expect(JSON.stringify(h.providerCalls[0])).not.toContain('sk-should-not-be-stored');
  });

  it('appends a provider model without touching the stored secret', async () => {
    ctx.repos.providers.upsert({
      id: 'prv_a',
      kind: 'openai-compatible',
      label: 'Local',
      config: {
        baseUrl: 'http://localhost:1234/v1',
        models: [{ id: 'm1', label: 'm1', isDefault: true }],
      },
      secretRef: 'provider:prv_a',
    });
    const h = harness();

    const result = await h.run(
      'config',
      { action: 'provider.model.add', providerId: 'prv_a', modelId: 'm2' },
      'C:/work',
    );

    expect(result).toBe('prv_a:m2');
    expect(h.providerCalls[0]?.id).toBe('prv_a');
    expect(h.providerCalls[0]?.secret).toBeUndefined();
    expect(h.providerCalls[0]?.config['models']).toEqual([
      { id: 'm1', label: 'm1', isDefault: true },
      { id: 'm2', label: 'm2', isDefault: false },
    ]);
  });

  it('replaces an existing provider model by id and keeps its label', async () => {
    ctx.repos.providers.upsert({
      id: 'prv_a',
      kind: 'openai-compatible',
      label: 'Local',
      config: { baseUrl: 'http://localhost:1234/v1', models: [{ id: 'm1', label: 'Old name' }] },
    });
    const h = harness();

    await h.run(
      'config',
      { action: 'provider.model.add', providerId: 'prv_a', modelId: 'm1' },
      'C:/work',
    );

    expect(h.providerCalls[0]?.config['models']).toEqual([{ id: 'm1', label: 'Old name' }]);
  });

  it('adds an MCP server with parsed args and env', async () => {
    const h = harness();

    const id = await h.run(
      'config',
      {
        action: 'mcp.add',
        label: 'fs',
        command: 'npx',
        args: '["-y","server-fs"]',
        env: '{"ROOT":"C:/work"}',
        cwd: 'C:/work',
      },
      'C:/work',
    );

    expect(id).toMatch(/^mcp_/);
    expect(h.mcpCalls[0]).toEqual({
      label: 'fs',
      command: 'npx',
      args: ['-y', 'server-fs'],
      env: { ROOT: 'C:/work' },
      cwd: 'C:/work',
    });
  });

  it('rejects a secret-like MCP env key and points at Settings', async () => {
    const h = harness();

    const text = await h.run(
      'config',
      {
        action: 'mcp.add',
        label: 'fs',
        command: 'npx',
        env: '{"ROOT":"C:/work","OPENAI_API_KEY":"sk-test"}',
      },
      'C:/work',
    );

    expect(text).toContain('OPENAI_API_KEY');
    expect(text).toContain('Settings > MCP env');
    expect(h.mcpCalls).toEqual([]);
    expect(ctx.repos.mcp.list()).toEqual([]);
  });

  it('rejects a token, secret or password env key too', async () => {
    const h = harness();

    for (const key of ['GITHUB_TOKEN', 'client_secret', 'DB_PASSWORD', 'AWS_CREDENTIAL']) {
      const text = await h.run(
        'config',
        { action: 'mcp.add', label: 'fs', command: 'npx', env: `{"${key}":"value"}` },
        'C:/work',
      );
      expect(text).toContain(key);
      expect(text).toContain('Settings > MCP env');
    }
    expect(h.mcpCalls).toEqual([]);
  });

  it('rejects a setting outside the allowlist and applies an allowed one', async () => {
    const h = harness();
    const shell = ctx.repos.settings.get().shell;

    const rejected = await h.run(
      'config',
      { action: 'settings.set', key: 'shell', value: 'pwsh' },
      'C:/work',
    );
    expect(rejected).toContain('setting not allowed: shell');
    expect(ctx.repos.settings.get().shell).toBe(shell);

    const applied = await h.run(
      'config',
      { action: 'settings.set', key: 'maxOutputTokens', value: '4096' },
      'C:/work',
    );
    expect(applied).toBe('maxOutputTokens');
    expect(ctx.repos.settings.get().maxOutputTokens).toBe(4096);
  });

  it('rejects an invalid value for an allowed setting', async () => {
    const h = harness();

    const text = await h.run(
      'config',
      { action: 'settings.set', key: 'maxOutputTokens', value: 'not-a-number' },
      'C:/work',
    );

    expect(text).not.toBe('maxOutputTokens');
    expect(ctx.repos.settings.get().maxOutputTokens).toBe(DEFAULT_SETTINGS.maxOutputTokens);
  });

  it('returns an error string for an unknown tool or action', async () => {
    const h = harness();

    await expect(h.run('nope', {}, 'C:/work')).resolves.toBe('unknown tool: nope');
    await expect(h.run('mcp', { action: 'nope' }, 'C:/work')).resolves.toBe('unknown mcp action: nope');
    await expect(h.run('config', { action: 'nope' }, 'C:/work')).resolves.toBe(
      'unknown config action: nope',
    );
  });
});
