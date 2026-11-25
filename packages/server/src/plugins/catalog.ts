import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogEntry, PluginComponents, PluginKind } from '@tuffcode/contracts';
import { z } from 'zod';

/**
 * Plugin marketplaces in the Claude Code format: a GitHub repository with
 * `.claude-plugin/marketplace.json`. Fetched only on a user action, cached on disk for
 * a day, parsed leniently (a bad entry is skipped and counted, never fatal), and
 * served stale with an error when the network fails.
 */
export interface MarketplaceDef {
  id: string;
  label: string;
  /** `owner/repo` or an https URL to a marketplace.json file. */
  url: string;
  verified: boolean;
  builtIn: boolean;
}

export const BUILT_IN_MARKETPLACES: readonly MarketplaceDef[] = [
  { id: 'official', label: 'Anthropic official', url: 'anthropics/claude-plugins-official', verified: true, builtIn: true },
  { id: 'knowledge-work', label: 'Anthropic knowledge work', url: 'anthropics/knowledge-work-plugins', verified: true, builtIn: true },
  { id: 'skills', label: 'Anthropic skills', url: 'anthropics/skills', verified: true, builtIn: true },
  { id: 'community', label: 'Claude community', url: 'anthropics/claude-plugins-community', verified: false, builtIn: true },
];

export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_TIMEOUT_MS = 15_000;
export const CATALOG_BYTE_LIMIT = 8 * 1024 * 1024;

export type CatalogFetch = (input: string, init: RequestInit) => Promise<Response>;

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const SourceSchema = z.union([
  z.string().min(1),
  z
    .object({
      source: z.string(),
      url: z.string().optional(),
      repo: z.string().optional(),
      path: z.string().optional(),
      ref: z.string().optional(),
      sha: z.string().optional(),
    })
    .passthrough(),
]);

const AuthorSchema = z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()]);

export const RawEntrySchema = z
  .object({
    name: z.string().min(1).max(120),
    displayName: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    author: AuthorSchema.optional(),
    homepage: z.string().optional(),
    source: SourceSchema,
    skills: z.array(z.string()).optional(),
    commands: z.unknown().optional(),
    mcpServers: z.unknown().optional(),
  })
  .passthrough();
export type RawEntry = z.infer<typeof RawEntrySchema>;

export interface CatalogSnapshot {
  marketplaceId: string;
  entries: RawEntry[];
  fetchedAt: string | null;
  error: string | null;
  skipped: number;
}

const CacheFileSchema = z.object({
  fetchedAt: z.string(),
  skipped: z.number().int().nonnegative().default(0),
  entries: z.array(z.unknown()),
});

/** Where a marketplace's manifest lives, and the GitHub repository behind it when known. */
export function marketplaceLocation(url: string): { manifestUrl: string; repo: string | null } {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (SLUG.test(trimmed)) {
    return {
      manifestUrl: `https://raw.githubusercontent.com/${trimmed}/HEAD/.claude-plugin/marketplace.json`,
      repo: trimmed,
    };
  }
  const github = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(trimmed);
  if (github?.[1] !== undefined) return marketplaceLocation(github[1]);
  if (/^https:\/\/\S+\.json$/i.test(trimmed)) return { manifestUrl: trimmed, repo: null };
  throw new Error('use a GitHub owner/repo, a github.com URL, or an https link to a marketplace.json');
}

function authorName(author: RawEntry['author']): string | null {
  if (author === undefined) return null;
  if (typeof author === 'string') return author.trim() || null;
  return typeof author.name === 'string' && author.name.trim().length > 0 ? author.name.trim() : null;
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? path;
}

function mcpNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value);
}

/** owner/repo of where the plugin's files come from, for the card label. */
export function entryRepo(entry: RawEntry, marketplaceRepo: string | null): string | null {
  if (typeof entry.source === 'string') return marketplaceRepo;
  const url = entry.source.url ?? (entry.source.repo === undefined ? undefined : `https://github.com/${entry.source.repo}`);
  if (url === undefined) return null;
  const match = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/.exec(url);
  return match?.[1] ?? null;
}

export function entryKind(entry: RawEntry): PluginKind {
  const skills = entry.skills?.length ?? 0;
  const servers = mcpNames(entry.mcpServers).length;
  if (servers > 0 && skills === 0) return 'connector';
  if (skills > 0 && servers === 0 && entry.commands === undefined) return 'skill';
  return 'plugin';
}

export function toCatalogEntry(
  entry: RawEntry,
  marketplace: MarketplaceDef,
  installed: boolean,
): CatalogEntry {
  const repo = entryRepo(entry, marketplaceLocation(marketplace.url).repo);
  const declared: Partial<PluginComponents> = {};
  if (entry.skills !== undefined) declared.skills = entry.skills.map(baseName);
  const servers = mcpNames(entry.mcpServers);
  if (servers.length > 0) declared.mcpServers = servers;
  const homepage = entry.homepage?.startsWith('https://') === true ? entry.homepage : null;
  return {
    id: `${marketplace.id}/${entry.name}`,
    marketplaceId: marketplace.id,
    name: entry.name,
    displayName: entry.displayName?.trim() || entry.name,
    description: (entry.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
    category: (entry.category ?? '').trim().toLowerCase() || 'other',
    author: authorName(entry.author),
    homepage,
    repo,
    kind: entryKind(entry),
    verified: marketplace.verified,
    components: Object.keys(declared).length === 0 ? null : declared,
    installed,
  };
}

/** Validates each entry on its own; the result keeps the good ones and counts the rest. */
export function parseMarketplace(raw: unknown): { entries: RawEntry[]; skipped: number } {
  const plugins =
    typeof raw === 'object' && raw !== null && 'plugins' in raw && Array.isArray(raw.plugins)
      ? (raw.plugins as unknown[])
      : null;
  if (plugins === null) throw new Error('the marketplace file has no plugins list');
  const entries: RawEntry[] = [];
  const names = new Set<string>();
  let skipped = 0;
  for (const candidate of plugins) {
    const parsed = RawEntrySchema.safeParse(candidate);
    if (!parsed.success || names.has(parsed.data.name)) {
      skipped += 1;
      continue;
    }
    names.add(parsed.data.name);
    entries.push(parsed.data);
  }
  return { entries, skipped };
}

async function fetchJson(url: string, fetchFn: CatalogFetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchFn(url, {
      headers: { accept: 'application/json', 'user-agent': 'Tuffcode' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`the marketplace answered with status ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > CATALOG_BYTE_LIMIT) throw new Error('the marketplace file is larger than 8 MB');
    const text = await response.text();
    if (text.length > CATALOG_BYTE_LIMIT) throw new Error('the marketplace file is larger than 8 MB');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('the marketplace file is not valid JSON');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`the marketplace did not answer in ${CATALOG_TIMEOUT_MS / 1000}s`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface CatalogStoreOptions {
  cacheDir: string;
  fetchFn?: CatalogFetch;
  now?: () => number;
}

export interface CatalogStore {
  /** Cached entries when fresh (or `refresh` is false and any cache exists), else a fetch. */
  load(marketplace: MarketplaceDef, refresh: boolean): Promise<CatalogSnapshot>;
  /** The cache only, never the network; null when nothing was fetched yet. */
  peek(marketplaceId: string): Promise<CatalogSnapshot | null>;
}

export function createCatalogStore(options: CatalogStoreOptions): CatalogStore {
  const fetchFn: CatalogFetch = options.fetchFn ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const file = (id: string): string => join(options.cacheDir, 'marketplaces', `${id}.json`);

  async function readCache(id: string): Promise<CatalogSnapshot | null> {
    try {
      const parsed = CacheFileSchema.safeParse(JSON.parse(await readFile(file(id), 'utf8')));
      if (!parsed.success) return null;
      const entries = parsed.data.entries
        .map((entry) => RawEntrySchema.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => result.data);
      return { marketplaceId: id, entries, fetchedAt: parsed.data.fetchedAt, error: null, skipped: parsed.data.skipped };
    } catch {
      return null;
    }
  }

  async function writeCache(id: string, snapshot: CatalogSnapshot): Promise<void> {
    const target = file(id);
    await mkdir(join(options.cacheDir, 'marketplaces'), { recursive: true });
    const temp = `${target}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({ fetchedAt: snapshot.fetchedAt, skipped: snapshot.skipped, entries: snapshot.entries }),
    );
    await rename(temp, target);
  }

  return {
    peek: readCache,
    async load(marketplace, refresh) {
      const cached = await readCache(marketplace.id);
      const fresh =
        cached?.fetchedAt !== null &&
        cached !== null &&
        now() - Date.parse(cached.fetchedAt ?? '') < CATALOG_TTL_MS;
      if (cached !== null && fresh && !refresh) return cached;
      try {
        const { manifestUrl } = marketplaceLocation(marketplace.url);
        const { entries, skipped } = parseMarketplace(await fetchJson(manifestUrl, fetchFn));
        const snapshot: CatalogSnapshot = {
          marketplaceId: marketplace.id,
          entries,
          fetchedAt: new Date(now()).toISOString(),
          error: null,
          skipped,
        };
        await writeCache(marketplace.id, snapshot).catch(() => undefined);
        return snapshot;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (cached !== null) return { ...cached, error: message };
        return { marketplaceId: marketplace.id, entries: [], fetchedAt: null, error: message, skipped: 0 };
      }
    },
  };
}
