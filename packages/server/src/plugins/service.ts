import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type {
  CatalogEntry,
  ConnectorEntry,
  InstalledPlugin,
  Marketplace,
  McpServer,
} from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { parseFrontmatter } from '../commands/frontmatter.js';
import type { Repos } from '../db/repos/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import type { McpService } from '../mcp/service.js';
import {
  BUILT_IN_MARKETPLACES,
  createCatalogStore,
  marketplaceLocation,
  toCatalogEntry,
  type CatalogFetch,
  type CatalogStore,
  type MarketplaceDef,
  type RawEntry,
} from './catalog.js';
import {
  archiveRoot,
  copyTree,
  defaultGit,
  defaultTar,
  extractArchive,
  fetchSource,
  makeWorkDir,
  placeSource,
  removeInside,
  resolveSource,
  type ArchiveTool,
  type GitRunner,
} from './install.js';
import { scanPlugin, type PluginMcpServer } from './manifest.js';
import { createConnectorRegistry, type ConnectorRegistry, type RegistryFetch } from './registry.js';

export interface PluginsServiceDeps {
  repos: Repos;
  bus?: EventBus;
  mcp: McpService;
  pluginsDir: string;
  cacheDir: string;
  fetchFn?: CatalogFetch & RegistryFetch;
  git?: GitRunner;
  tar?: ArchiveTool;
  /** Test seam: rewrites a validated clone URL to a local fixture. */
  cloneUrl?: (repoUrl: string) => string;
  now?: () => number;
}

export interface PluginsService {
  marketplaces(): Promise<Marketplace[]>;
  addMarketplace(url: string): Promise<Marketplace>;
  removeMarketplace(id: string): void;
  catalog(input: { marketplaceId?: string; refresh?: boolean }): Promise<{
    entries: CatalogEntry[];
    marketplaces: Marketplace[];
  }>;
  installed(): InstalledPlugin[];
  install(entryId: string): Promise<InstalledPlugin>;
  upload(path: string): Promise<InstalledPlugin>;
  setEnabled(id: string, enabled: boolean): InstalledPlugin;
  remove(id: string): Promise<void>;
  searchConnectors(query: string): Promise<{ entries: ConnectorEntry[]; error: string | null }>;
  installConnector(input: {
    entry: ConnectorEntry;
    env?: Record<string, string>;
    secret?: string;
  }): Promise<McpServer>;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const UPLOAD_EXTENSIONS = new Set(['.zip', '.skill', '.md']);
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

function safeDirName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80) || 'plugin';
}

export function createPluginsService(deps: PluginsServiceDeps): PluginsService {
  const { repos } = deps;
  const store: CatalogStore = createCatalogStore({
    cacheDir: deps.cacheDir,
    ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  const registry: ConnectorRegistry = createConnectorRegistry({
    ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  const git = deps.git ?? defaultGit();
  const tar = deps.tar ?? defaultTar();
  const nowIso = (): string => new Date(deps.now?.() ?? Date.now()).toISOString();

  function emit(): void {
    deps.bus?.emit({ kind: 'event', type: 'plugins.updated', payload: repos.plugins.list() });
  }

  function definitions(): MarketplaceDef[] {
    const user = repos.plugins.listMarketplaces().map(
      (row): MarketplaceDef => ({ id: row.id, label: row.label, url: row.url, verified: false, builtIn: false }),
    );
    return [...BUILT_IN_MARKETPLACES, ...user];
  }

  function requireMarketplace(id: string): MarketplaceDef {
    const found = definitions().find((entry) => entry.id === id);
    if (found === undefined) throw notFound(`marketplace not found: ${id}`);
    return found;
  }

  async function view(def: MarketplaceDef): Promise<Marketplace> {
    const snapshot = await store.peek(def.id);
    return {
      ...def,
      fetchedAt: snapshot?.fetchedAt ?? null,
      error: snapshot?.error ?? null,
      skipped: snapshot?.skipped ?? 0,
    };
  }

  /** Registers the plugin's MCP servers; a failure here rolls back the ones already written. */
  async function registerServers(pluginId: string, servers: PluginMcpServer[], enabled: boolean): Promise<void> {
    const written: string[] = [];
    try {
      for (const server of servers) {
        const saved =
          server.transport === 'http'
            ? await deps.mcp.save({
                label: server.name,
                transport: 'http',
                url: server.url,
                pluginId,
                enabled,
                ...(server.headers['Authorization'] ?? server.headers['authorization']
                  ? { secret: (server.headers['Authorization'] ?? server.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '') }
                  : {}),
              })
            : await deps.mcp.save({
                label: server.name,
                transport: 'stdio',
                command: server.command,
                args: server.args,
                env: server.env,
                pluginId,
                enabled,
              });
        written.push(saved.id);
      }
    } catch (error) {
      for (const id of written) deps.mcp.remove(id);
      throw error;
    }
  }

  /** Scans a placed install dir, writes the row and its servers, or cleans up and rethrows. */
  async function finishInstall(input: {
    installDir: string;
    marketplaceId: string | null;
    name: string;
    fallback: { displayName: string; description: string };
    kind?: InstalledPlugin['kind'];
    source: InstalledPlugin['source'];
  }): Promise<InstalledPlugin> {
    const manifest = scanPlugin(input.installDir);
    const components = manifest.components;
    if (components.skills.length + components.commands.length + components.mcpServers.length === 0) {
      throw badRequest('the plugin has no skills, commands or MCP servers Tuffcode can use');
    }
    const kind =
      input.kind ??
      (components.mcpServers.length > 0 && components.skills.length + components.commands.length === 0
        ? 'connector'
        : components.mcpServers.length === 0 && components.commands.length === 0
          ? 'skill'
          : 'plugin');
    const plugin: InstalledPlugin = {
      id: newId('plg'),
      marketplaceId: input.marketplaceId,
      name: input.name,
      displayName: manifest.displayName ?? input.fallback.displayName,
      description: manifest.description ?? input.fallback.description,
      version: manifest.version,
      kind,
      enabled: true,
      installPath: input.installDir,
      components,
      source: input.source,
      installedAt: nowIso(),
    };
    const inserted = repos.plugins.insert(plugin);
    try {
      await registerServers(inserted.id, manifest.mcpServers, true);
    } catch (error) {
      repos.plugins.remove(inserted.id);
      throw error;
    }
    emit();
    return inserted;
  }

  async function withWorkDir<T>(run: (workDir: string) => Promise<T>): Promise<T> {
    const workDir = await makeWorkDir(join(deps.pluginsDir, '.staging'));
    try {
      return await run(workDir);
    } finally {
      await removeInside(deps.pluginsDir, workDir).catch(() => undefined);
    }
  }

  async function findEntry(entryId: string): Promise<{ marketplace: MarketplaceDef; entry: RawEntry }> {
    const slash = entryId.indexOf('/');
    if (slash <= 0) throw badRequest('entry id must be <marketplace>/<name>');
    const marketplace = requireMarketplace(entryId.slice(0, slash));
    const name = entryId.slice(slash + 1);
    const snapshot = (await store.peek(marketplace.id)) ?? (await store.load(marketplace, false));
    const entry = snapshot.entries.find((candidate) => candidate.name === name);
    if (entry === undefined) throw notFound(`plugin not found in ${marketplace.label}: ${name}`);
    return { marketplace, entry };
  }

  return {
    marketplaces: () => Promise.all(definitions().map(view)),

    async addMarketplace(url) {
      const { repo } = marketplaceLocation(url);
      const normalized = repo ?? url.trim();
      if (definitions().some((entry) => entry.url.toLowerCase() === normalized.toLowerCase())) {
        throw conflict('that marketplace is already added');
      }
      const row = repos.plugins.addMarketplace({
        id: newId('mkt'),
        label: repo ?? new URL(normalized).hostname,
        url: normalized,
        verified: false,
        createdAt: nowIso(),
      });
      return view({ id: row.id, label: row.label, url: row.url, verified: false, builtIn: false });
    },

    removeMarketplace(id) {
      if (BUILT_IN_MARKETPLACES.some((entry) => entry.id === id)) {
        throw badRequest('built-in marketplaces cannot be removed');
      }
      repos.plugins.removeMarketplace(id);
    },

    async catalog({ marketplaceId, refresh }) {
      const targets = marketplaceId === undefined ? definitions() : [requireMarketplace(marketplaceId)];
      const installed = new Set(
        repos.plugins.list().map((plugin) => `${plugin.marketplaceId ?? ''}/${plugin.name}`),
      );
      const snapshots = await Promise.all(targets.map((def) => store.load(def, refresh === true)));
      const entries: CatalogEntry[] = [];
      snapshots.forEach((snapshot, index) => {
        const def = targets[index];
        if (def === undefined) return;
        for (const raw of snapshot.entries) {
          entries.push(toCatalogEntry(raw, def, installed.has(`${def.id}/${raw.name}`)));
        }
      });
      return {
        entries,
        marketplaces: snapshots.map((snapshot, index) => ({
          ...(targets[index] as MarketplaceDef),
          fetchedAt: snapshot.fetchedAt,
          error: snapshot.error,
          skipped: snapshot.skipped,
        })),
      };
    },

    installed: () => repos.plugins.list(),

    async install(entryId) {
      const { marketplace, entry } = await findEntry(entryId);
      if (!NAME.test(entry.name)) throw badRequest('the plugin name is not usable as a directory');
      if (repos.plugins.findByName(marketplace.id, entry.name) !== undefined) {
        throw conflict(`${entry.name} is already installed`);
      }
      const source = resolveSource(entry, marketplaceLocation(marketplace.url).repo);
      const installDir = join(deps.pluginsDir, safeDirName(marketplace.id), safeDirName(entry.name));
      if (existsSync(installDir)) await removeInside(deps.pluginsDir, installDir);
      try {
        await withWorkDir(async (workDir) => {
          const repo = await fetchSource(source, workDir, git, deps.cloneUrl);
          await placeSource(repo, source, installDir);
        });
        return await finishInstall({
          installDir,
          marketplaceId: marketplace.id,
          name: entry.name,
          fallback: {
            displayName: entry.displayName?.trim() || entry.name,
            description: (entry.description ?? '').trim(),
          },
          source: 'marketplace',
        });
      } catch (error) {
        await removeInside(deps.pluginsDir, installDir).catch(() => undefined);
        throw error;
      }
    },

    async upload(path) {
      const extension = extname(path).toLowerCase();
      if (!UPLOAD_EXTENSIONS.has(extension)) throw badRequest('upload a .zip, .skill or .md file');
      if (!existsSync(path)) throw notFound('the file does not exist');
      return withWorkDir(async (workDir) => {
        let root: string;
        let name: string;
        if (extension === '.md') {
          const parsed = parseFrontmatter(readFileSync(path, 'utf8'));
          const skillName = parsed?.data.name?.trim() ?? '';
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(skillName) || (parsed?.data.description?.trim() ?? '') === '') {
            throw badRequest('a .md upload needs name and description frontmatter');
          }
          root = join(workDir, 'single');
          await mkdir(join(root, 'skills', skillName), { recursive: true });
          await writeFile(join(root, 'skills', skillName, 'SKILL.md'), readFileSync(path));
          name = skillName;
        } else {
          root = await archiveRoot(await extractArchive(path, workDir, tar));
          // A bare skill folder (SKILL.md at its root) becomes a one-skill plugin.
          if (existsSync(join(root, 'SKILL.md')) && !existsSync(join(root, 'skills'))) {
            const parsed = parseFrontmatter(readFileSync(join(root, 'SKILL.md'), 'utf8'));
            const skillName = parsed?.data.name?.trim() || basename(root);
            const wrapped = join(workDir, 'wrapped');
            await copyTree(root, join(wrapped, 'skills', safeDirName(skillName)));
            root = wrapped;
            name = skillName;
          } else {
            name = scanPlugin(root).name ?? basename(path, extension);
          }
        }
        if (!NAME.test(name)) throw badRequest('the plugin name is not usable as a directory');
        if (repos.plugins.findByName(null, name) !== undefined) throw conflict(`${name} is already installed`);
        const installDir = join(deps.pluginsDir, 'local', safeDirName(name));
        if (existsSync(installDir)) await removeInside(deps.pluginsDir, installDir);
        await mkdir(join(deps.pluginsDir, 'local'), { recursive: true });
        try {
          await copyTree(root, installDir);
          return await finishInstall({
            installDir,
            marketplaceId: null,
            name,
            fallback: { displayName: name, description: 'Installed from a local file' },
            source: 'upload',
          });
        } catch (error) {
          await removeInside(deps.pluginsDir, installDir).catch(() => undefined);
          throw error;
        }
      });
    },

    setEnabled(id, enabled) {
      const plugin = repos.plugins.get(id);
      if (plugin === undefined) throw notFound('plugin not found');
      const updated = repos.plugins.setEnabled(id, enabled) ?? plugin;
      repos.mcp.setEnabledByPlugin(id, enabled);
      emit();
      return updated;
    },

    async remove(id) {
      const plugin = repos.plugins.get(id);
      if (plugin === undefined) throw notFound('plugin not found');
      for (const server of repos.mcp.listByPlugin(id)) deps.mcp.remove(server.id);
      repos.plugins.remove(id);
      await removeInside(deps.pluginsDir, plugin.installPath).catch(() => undefined);
      emit();
    },

    searchConnectors: (query) => registry.search(query),

    async installConnector({ entry, env, secret }) {
      const label = entry.title.trim() || entry.name;
      if (entry.remoteUrl !== null) {
        return deps.mcp.save({
          label,
          transport: 'http',
          url: entry.remoteUrl,
          ...(secret === undefined || secret.length === 0 ? {} : { secret }),
        });
      }
      if (entry.npmPackage === null) throw badRequest('this connector has no endpoint or package to run');
      const values = env ?? {};
      const missing = entry.requiredEnv.filter((key) => (values[key] ?? '').trim().length === 0);
      if (missing.length > 0) throw badRequest(`fill in ${missing.join(', ')} first`);
      // Secret-shaped values go to the secret bridge; the row keeps only the plain ones.
      const plain: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (SECRET_ENV.test(key)) secrets[key] = value;
        else plain[key] = value;
      }
      return deps.mcp.save({
        label,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', entry.npmPackage],
        env: plain,
        ...(Object.keys(secrets).length === 0 ? {} : { secretEnv: secrets }),
      });
    },
  };
}

/** Writes a JSON file atomically; used by tests that seed a marketplace cache. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}
