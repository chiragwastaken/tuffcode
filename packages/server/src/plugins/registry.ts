import type { ConnectorEntry } from '@tuffcode/contracts';
import { z } from 'zod';

/**
 * The official MCP registry, for the Connectors tab. Searched only when the user
 * types in that tab, cached in memory for an hour per query, and reduced to what the
 * card shows and what an install needs: a hosted streamable-http endpoint or an npm
 * package launched with npx.
 */
export const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';
export const REGISTRY_TIMEOUT_MS = 10_000;
export const REGISTRY_CACHE_MS = 60 * 60 * 1000;
export const REGISTRY_PAGE = 30;

export type RegistryFetch = (input: string, init: RequestInit) => Promise<Response>;

const EnvSchema = z.object({ name: z.string(), isRequired: z.boolean().optional(), isSecret: z.boolean().optional() });

const ServerSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    repository: z.object({ url: z.string().optional() }).passthrough().optional(),
    remotes: z.array(z.object({ type: z.string(), url: z.string() }).passthrough()).optional(),
    packages: z
      .array(
        z
          .object({
            registryType: z.string().optional(),
            identifier: z.string().optional(),
            version: z.string().optional(),
            transport: z.object({ type: z.string() }).passthrough().optional(),
            environmentVariables: z.array(EnvSchema).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const PageSchema = z.object({
  servers: z.array(z.object({ server: z.unknown() }).passthrough()),
});

const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function toConnectorEntry(raw: unknown): ConnectorEntry | null {
  const parsed = ServerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const server = parsed.data;
  const remote = server.remotes?.find(
    (entry) => entry.type === 'streamable-http' && entry.url.startsWith('https://'),
  );
  const npm = server.packages?.find(
    (entry) =>
      entry.registryType === 'npm' &&
      entry.identifier !== undefined &&
      NPM_NAME.test(entry.identifier) &&
      (entry.transport?.type ?? 'stdio') === 'stdio',
  );
  if (remote === undefined && npm === undefined) return null;
  const version = npm?.version ?? server.version ?? null;
  return {
    name: server.name,
    title: server.title?.trim() || server.name.split('/').at(-1) || server.name,
    description: (server.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    version,
    remoteUrl: remote?.url ?? null,
    npmPackage: npm?.identifier === undefined ? null : `${npm.identifier}${version === null ? '' : `@${version}`}`,
    requiredEnv: (npm?.environmentVariables ?? [])
      .filter((entry) => entry.isRequired === true)
      .map((entry) => entry.name)
      .filter((name) => /^[A-Z_][A-Z0-9_]*$/i.test(name)),
    repository: server.repository?.url?.startsWith('https://') === true ? server.repository.url : null,
  };
}

export interface ConnectorRegistry {
  search(query: string): Promise<{ entries: ConnectorEntry[]; error: string | null }>;
}

export function createConnectorRegistry(
  options: { fetchFn?: RegistryFetch; now?: () => number } = {},
): ConnectorRegistry {
  const fetchFn: RegistryFetch = options.fetchFn ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; entries: ConnectorEntry[] }>();

  return {
    async search(query) {
      const key = query.trim().toLowerCase();
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < REGISTRY_CACHE_MS) return { entries: hit.entries, error: null };
      const url = new URL(MCP_REGISTRY_URL);
      url.searchParams.set('limit', String(REGISTRY_PAGE));
      url.searchParams.set('version', 'latest');
      if (key.length > 0) url.searchParams.set('search', key);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
      timer.unref?.();
      try {
        const response = await fetchFn(url.toString(), {
          headers: { accept: 'application/json', 'user-agent': 'Tuffcode' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`the MCP registry answered with status ${response.status}`);
        const page = PageSchema.safeParse(await response.json());
        if (!page.success) throw new Error('the MCP registry sent an unexpected response');
        const seen = new Set<string>();
        const entries: ConnectorEntry[] = [];
        for (const row of page.data.servers) {
          const entry = toConnectorEntry(row.server);
          if (entry === null || seen.has(entry.name)) continue;
          seen.add(entry.name);
          entries.push(entry);
        }
        cache.set(key, { at: now(), entries });
        return { entries, error: null };
      } catch (error) {
        const message = controller.signal.aborted
          ? 'the MCP registry did not answer in 10s'
          : error instanceof Error
            ? error.message
            : String(error);
        return { entries: hit?.entries ?? [], error: message };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
