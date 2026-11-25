import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerEvent } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../events.js';
import { createMcpService } from '../mcp/service.js';
import { createTestContext, git, initRepo, type TestContext } from '../test-support.js';
import {
  BUILT_IN_MARKETPLACES,
  createCatalogStore,
  marketplaceLocation,
  parseMarketplace,
  toCatalogEntry,
  type CatalogFetch,
} from './catalog.js';
import { extractArchive, resolveSource, unsafeArchiveEntry, validateGitUrl } from './install.js';
import { parseMcpServers, scanPlugin } from './manifest.js';
import { toConnectorEntry } from './registry.js';
import { createPluginsService, type PluginsService } from './service.js';

const NOW = Date.parse('2026-11-25T10:00:00.000Z');
const OFFICIAL = BUILT_IN_MARKETPLACES[0]!;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function writeFile(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

describe('marketplace catalog', () => {
  it('maps owner/repo, github URLs and direct JSON links', () => {
    expect(marketplaceLocation('anthropics/claude-plugins-official')).toEqual({
      manifestUrl:
        'https://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/.claude-plugin/marketplace.json',
      repo: 'anthropics/claude-plugins-official',
    });
    expect(marketplaceLocation('https://github.com/acme/plugins.git').repo).toBe('acme/plugins');
    expect(marketplaceLocation('https://example.com/m.json').repo).toBeNull();
    expect(() => marketplaceLocation('http://example.com/m.json')).toThrow();
    expect(() => marketplaceLocation('not a slug')).toThrow();
  });

  it('keeps good entries, counts bad and duplicate ones, and classifies kinds', () => {
    const { entries, skipped } = parseMarketplace({
      plugins: [
        { name: 'github', source: { source: 'url', url: 'https://github.com/github/plugin.git' }, mcpServers: { github: {} } },
        { name: 'docs', source: './', skills: ['./skills/docx', './skills/pdf'] },
        { name: 'productivity', source: './productivity', description: '  Plan   your day ' },
        { name: 'productivity', source: './dup' },
        { description: 'no name', source: './x' },
        'not an object',
      ],
    });
    expect(entries.map((entry) => entry.name)).toEqual(['github', 'docs', 'productivity']);
    expect(skipped).toBe(3);
    const cards = entries.map((entry) => toCatalogEntry(entry, OFFICIAL, false));
    expect(cards.map((card) => card.kind)).toEqual(['connector', 'skill', 'plugin']);
    expect(cards[0]?.repo).toBe('github/plugin');
    expect(cards[1]?.components).toEqual({ skills: ['docx', 'pdf'] });
    expect(cards[2]).toMatchObject({
      id: 'official/productivity',
      description: 'Plan your day',
      repo: 'anthropics/claude-plugins-official',
      verified: true,
      category: 'other',
    });
    expect(() => parseMarketplace({ nope: [] })).toThrow(/plugins list/);
  });

  it('serves the cache while fresh, refetches on refresh, and falls back to stale on failure', async () => {
    const ctx = createTestContext();
    try {
      let calls = 0;
      let online = true;
      const fetchFn: CatalogFetch = async () => {
        calls += 1;
        if (!online) throw new Error('offline');
        return jsonResponse({ plugins: [{ name: `p${calls}`, source: './p' }] });
      };
      let now = NOW;
      const store = createCatalogStore({ cacheDir: ctx.env.root, fetchFn, now: () => now });
      expect((await store.load(OFFICIAL, false)).entries.map((entry) => entry.name)).toEqual(['p1']);
      expect((await store.load(OFFICIAL, false)).entries.map((entry) => entry.name)).toEqual(['p1']);
      expect(calls).toBe(1);
      expect((await store.load(OFFICIAL, true)).entries.map((entry) => entry.name)).toEqual(['p2']);
      online = false;
      now += 2 * 24 * 60 * 60 * 1000;
      const stale = await store.load(OFFICIAL, false);
      expect(stale.entries.map((entry) => entry.name)).toEqual(['p2']);
      expect(stale.error).toBe('offline');
      const missing = await store.load(BUILT_IN_MARKETPLACES[3]!, false);
      expect(missing).toMatchObject({ entries: [], fetchedAt: null, error: 'offline' });
    } finally {
      ctx.dispose();
    }
  });

  it('reports a malformed or failing marketplace without throwing', async () => {
    const ctx = createTestContext();
    try {
      const store = createCatalogStore({
        cacheDir: ctx.env.root,
        fetchFn: async () => new Response('{not json', { status: 200 }),
      });
      expect((await store.load(OFFICIAL, true)).error).toMatch(/not valid JSON/);
      const notFound = createCatalogStore({ cacheDir: ctx.env.root, fetchFn: async () => jsonResponse({}, 404) });
      expect((await notFound.load(BUILT_IN_MARKETPLACES[1]!, true)).error).toMatch(/404/);
    } finally {
      ctx.dispose();
    }
  });
});

describe('plugin sources and archives', () => {
  it('resolves catalog sources onto allowed git hosts only', () => {
    expect(resolveSource({ name: 'a', source: './plugins/a' }, 'acme/market')).toEqual({
      repoUrl: 'https://github.com/acme/market.git',
      subdir: 'plugins/a',
      ref: null,
      skillPaths: null,
    });
    expect(
      resolveSource({ name: 'docs', source: './', skills: ['./skills/pdf'] }, 'anthropics/skills').skillPaths,
    ).toEqual(['skills/pdf']);
    expect(
      resolveSource(
        { name: 'b', source: { source: 'git-subdir', url: 'https://github.com/o/r.git', path: 'x', sha: 'abc123' } },
        null,
      ),
    ).toMatchObject({ subdir: 'x', ref: 'abc123' });
    expect(() => resolveSource({ name: 'c', source: './../escape' }, 'acme/market')).toThrow(/leaves/);
    expect(() => validateGitUrl('https://evil.example.com/x.git')).toThrow(/GitHub or GitLab/);
    expect(() => validateGitUrl('http://github.com/o/r.git')).toThrow(/GitHub or GitLab/);
    expect(() =>
      resolveSource({ name: 'd', source: { source: 'npm', url: 'x' } }, null),
    ).toThrow(/not supported/);
    expect(() =>
      resolveSource({ name: 'e', source: { source: 'url', url: 'https://github.com/o/r.git', ref: '--upload-pack=x' } }, null),
    ).toThrow(/unsafe ref/);
  });

  it('refuses archives with escaping or absolute entries before extracting', async () => {
    for (const bad of ['../evil.txt', 'a/../../evil', '/etc/passwd', 'C:/Windows/x', '..\\evil']) {
      expect(unsafeArchiveEntry(bad)).toBe(true);
    }
    expect(unsafeArchiveEntry('skills/pdf/SKILL.md')).toBe(false);
    const writes: string[] = [];
    const tar = async (args: readonly string[]): Promise<string> => {
      if (args[0] === '-tf') return 'ok.txt\n../evil.txt\n';
      writes.push(args.join(' '));
      return '';
    };
    await expect(extractArchive('x.zip', 'C:/tmp', tar)).rejects.toThrow(/unsafe path/);
    expect(writes).toEqual([]);
  });

  it('scans a plugin directory and expands the plugin root in MCP definitions', () => {
    const ctx = createTestContext();
    try {
      const root = ctx.env.root;
      writeFile(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'kit', version: '1.2.0', description: 'Kit' }));
      writeFile(root, 'skills/triage/SKILL.md', '---\nname: triage\ndescription: Triage issues\n---\nbody\n');
      writeFile(root, 'commands/ship.md', 'Ship the branch\n');
      writeFile(root, 'agents/helper.md', 'helper\n');
      writeFile(root, 'hooks/hooks.json', '{}');
      writeFile(
        root,
        '.mcp.json',
        JSON.stringify({
          mcpServers: {
            local: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] },
            remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
            broken: { type: 'http' },
          },
        }),
      );
      const manifest = scanPlugin(root);
      expect(manifest).toMatchObject({ name: 'kit', version: '1.2.0', description: 'Kit' });
      expect(manifest.components).toEqual({
        skills: ['triage'],
        commands: ['ship'],
        mcpServers: ['local', 'remote'],
        agents: ['helper'],
        hooks: true,
      });
      expect(manifest.mcpServers[0]).toEqual({
        name: 'local',
        transport: 'stdio',
        command: 'node',
        args: [`${root}/server.js`],
        env: {},
      });
      expect(manifest.mcpServers[1]).toEqual({
        name: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: {},
      });
      expect(parseMcpServers([], root)).toEqual([]);
    } finally {
      ctx.dispose();
    }
  });

  it('maps registry servers to connectors and skips unusable ones', () => {
    expect(
      toConnectorEntry({
        name: 'io.example/weather',
        title: 'Weather',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }],
      }),
    ).toMatchObject({ remoteUrl: 'https://mcp.example.com/mcp', npmPackage: null });
    expect(
      toConnectorEntry({
        name: 'io.example/files',
        version: '2.0.0',
        packages: [
          {
            registryType: 'npm',
            identifier: '@example/files-mcp',
            version: '2.0.0',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'API_KEY', isRequired: true }, { name: 'OPTIONAL' }],
          },
        ],
      }),
    ).toMatchObject({ npmPackage: '@example/files-mcp@2.0.0', requiredEnv: ['API_KEY'] });
    expect(toConnectorEntry({ name: 'x', remotes: [{ type: 'sse', url: 'http://plain' }] })).toBeNull();
    expect(toConnectorEntry({ nope: true })).toBeNull();
  });
});

describe('plugins service', () => {
  let ctx: TestContext;
  let service: PluginsService;
  let events: ServerEvent[];
  let fixtureRepo: string;

  beforeEach(() => {
    ctx = createTestContext();
    fixtureRepo = initRepo(join(ctx.env.root, 'fixture-market'));
    writeFile(fixtureRepo, 'plugins/kit/.claude-plugin/plugin.json', JSON.stringify({ name: 'kit', description: 'Kit tools' }));
    writeFile(fixtureRepo, 'plugins/kit/skills/triage/SKILL.md', '---\nname: triage\ndescription: Triage\n---\nTriage body\n');
    writeFile(fixtureRepo, 'plugins/kit/commands/ship.md', 'Ship it\n');
    writeFile(fixtureRepo, 'plugins/kit/.mcp.json', JSON.stringify({ mcpServers: { echo: { command: 'node', args: ['echo.js'] } } }));
    writeFile(fixtureRepo, 'plugins/other/README.md', 'not part of kit\n');
    git(fixtureRepo, ['add', '-A']);
    git(fixtureRepo, ['commit', '-m', 'plugins']);
    const bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
    service = createPluginsService({
      repos: ctx.repos,
      bus,
      mcp: createMcpService(ctx.repos),
      pluginsDir: join(ctx.env.root, 'plugins'),
      cacheDir: join(ctx.env.root, 'cache'),
      fetchFn: async () =>
        jsonResponse({
          plugins: [
            { name: 'kit', source: './plugins/kit', description: 'Kit from the catalog' },
            { name: 'empty', source: './plugins/other' },
          ],
        }),
      cloneUrl: () => pathToFileURL(fixtureRepo).href,
    });
  });

  afterEach(() => ctx.dispose());

  it('installs from a marketplace, toggles its servers, and removes everything', async () => {
    const catalog = await service.catalog({ marketplaceId: 'official', refresh: true });
    expect(catalog.entries.map((entry) => entry.id)).toEqual(['official/kit', 'official/empty']);

    const plugin = await service.install('official/kit');
    expect(plugin).toMatchObject({ name: 'kit', description: 'Kit tools', kind: 'plugin', enabled: true });
    expect(plugin.components).toMatchObject({ skills: ['triage'], commands: ['ship'], mcpServers: ['echo'] });
    expect(readFileSync(join(plugin.installPath, 'skills', 'triage', 'SKILL.md'), 'utf8')).toContain('Triage body');
    expect(existsSync(join(plugin.installPath, '..', 'other'))).toBe(false);
    expect(existsSync(join(plugin.installPath, '.git'))).toBe(false);
    const servers = ctx.repos.mcp.listByPlugin(plugin.id);
    expect(servers.map((server) => [server.label, server.command, server.enabled])).toEqual([['echo', 'node', true]]);
    expect((await service.catalog({ marketplaceId: 'official' })).entries[0]?.installed).toBe(true);
    await expect(service.install('official/kit')).rejects.toThrow(/already installed/);

    service.setEnabled(plugin.id, false);
    expect(ctx.repos.mcp.listByPlugin(plugin.id)[0]?.enabled).toBe(false);
    expect(events.filter((event) => event.type === 'plugins.updated')).toHaveLength(2);

    await service.remove(plugin.id);
    expect(service.installed()).toEqual([]);
    expect(ctx.repos.mcp.listByPlugin(plugin.id)).toEqual([]);
    expect(existsSync(plugin.installPath)).toBe(false);
  });

  it('refuses a plugin with nothing usable and leaves no files behind', async () => {
    await service.catalog({ marketplaceId: 'official', refresh: true });
    await expect(service.install('official/empty')).rejects.toThrow(/no skills, commands or MCP servers/);
    expect(service.installed()).toEqual([]);
    expect(existsSync(join(ctx.env.root, 'plugins', 'official', 'empty'))).toBe(false);
  });

  it('installs a single SKILL.md upload and rejects one without frontmatter', async () => {
    const good = join(ctx.env.root, 'deploy.md');
    writeFileSync(good, '---\nname: deploy\ndescription: Deploy the app\n---\nRun deploy.ps1\n');
    const plugin = await service.upload(good);
    expect(plugin).toMatchObject({ name: 'deploy', kind: 'skill', source: 'upload', marketplaceId: null });
    expect(existsSync(join(plugin.installPath, 'skills', 'deploy', 'SKILL.md'))).toBe(true);
    const bad = join(ctx.env.root, 'notes.md');
    writeFileSync(bad, '# just notes\n');
    await expect(service.upload(bad)).rejects.toThrow(/frontmatter/);
    await expect(service.upload(join(ctx.env.root, 'x.exe'))).rejects.toThrow(/\.zip, \.skill or \.md/);
  });

  it('adds and removes user marketplaces but keeps the built-in ones', async () => {
    const added = await service.addMarketplace('https://github.com/acme/plugins');
    expect(added).toMatchObject({ label: 'acme/plugins', url: 'acme/plugins', builtIn: false, verified: false });
    await expect(service.addMarketplace('acme/plugins')).rejects.toThrow(/already added/);
    expect(() => service.removeMarketplace('official')).toThrow(/built-in/);
    service.removeMarketplace(added.id);
    expect((await service.marketplaces()).map((entry) => entry.id)).toEqual(
      BUILT_IN_MARKETPLACES.map((entry) => entry.id),
    );
  });

  it('installs a hosted connector as an http server and keeps npm secrets out of the row', async () => {
    const remote = await service.installConnector({
      entry: {
        name: 'io.example/weather',
        title: 'Weather',
        description: '',
        version: null,
        remoteUrl: 'https://mcp.example.com/mcp',
        npmPackage: null,
        requiredEnv: [],
        repository: null,
      },
    });
    expect(remote).toMatchObject({ transport: 'http', url: 'https://mcp.example.com/mcp', command: '' });
    const entry = {
      name: 'io.example/files',
      title: 'Files',
      description: '',
      version: '2.0.0',
      remoteUrl: null,
      npmPackage: '@example/files-mcp@2.0.0',
      requiredEnv: ['ROOT'],
      repository: null,
    };
    await expect(service.installConnector({ entry })).rejects.toThrow(/fill in ROOT/);
    const local = await service.installConnector({ entry, env: { ROOT: 'C:/work' } });
    expect(local).toMatchObject({ command: 'npx', args: ['-y', '@example/files-mcp@2.0.0'], env: { ROOT: 'C:/work' } });
    // No secret bridge in this context, so a secret-shaped value is refused rather than stored.
    await expect(service.installConnector({ entry, env: { ROOT: 'C:/work', API_KEY: 'k' } })).rejects.toThrow(
      /secret storage is unavailable/,
    );
    expect(JSON.stringify(ctx.repos.mcp.list())).not.toContain('"k"');
    expect(ctx.repos.mcp.list()).toHaveLength(2);
  });
});
