import type { McpServer, McpServerLaunch, McpTool } from '@tuffcode/contracts';
import type { McpRepo, UpsertMcpServerInput } from '../db/repos/index.js';
import { badRequest, notFound } from '../errors.js';
import type { Secrets } from '../secrets/bridge.js';
import { createMcpClient, type McpClient, type McpSpawnFn } from './client.js';
import { createHttpMcpClient, validateMcpUrl, type McpFetch } from './http-client.js';

/**
 * The MCP service owns the configured servers, the 60s tool cache and the two
 * agent-facing operations. Every call opens its own short-lived client; the cache
 * keeps repeated `tools/list` calls from spawning a child each turn.
 */
export const MCP_TOOL_CACHE_TTL_MS = 60_000;

export interface McpServiceRepos {
  mcp: McpRepo;
}

export interface McpServiceOptions {
  timeoutMs?: number;
  spawnFn?: McpSpawnFn;
  now?: () => number;
  /** Holds connector bearer tokens; absent means http servers run without one. */
  secrets?: Pick<Secrets, 'get' | 'set'>;
  fetchFn?: McpFetch;
}

/**
 * What the settings form and the plugin installer send: a row plus an optional secret.
 * For an http server the secret is the bearer token; for a stdio server it is a map of
 * secret environment variables merged into the child's env at launch. Either way it
 * lives in the secret bridge, never in the database.
 */
export type UpsertMcpWithSecretInput = Omit<UpsertMcpServerInput, 'secretRef'> & {
  secret?: string;
  secretEnv?: Record<string, string>;
};

function secretEnvOf(value: string | null): Record<string, string> {
  if (value === null || !value.startsWith('{')) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export interface McpTestResult {
  ok: boolean;
  detail: string;
  tools: McpTool[];
}

export interface McpService {
  list(): McpServer[];
  upsert(input: UpsertMcpServerInput): McpServer;
  /** Validates the transport, stores the token in the secret bridge, then writes the row. */
  save(input: UpsertMcpWithSecretInput): Promise<McpServer>;
  /** Enabled servers as vendor CLIs launch them, keyed by a unique label. Sync for the SDK. */
  launchMap(): Record<string, McpServerLaunch>;
  /** Loads stored tokens into memory so `launchMap` can attach them synchronously. */
  warmSecrets(): Promise<void>;
  remove(id: string): void;
  test(id: string): Promise<McpTestResult>;
  listTools(id: string): Promise<McpTool[]>;
  callTool(id: string, tool: string, args: Record<string, unknown>): Promise<string>;
}

interface CachedTools {
  tools: McpTool[];
  at: number;
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'connection failed';
}

export function createMcpService(
  repos: McpServiceRepos,
  options: McpServiceOptions = {},
): McpService {
  const now = options.now ?? Date.now;
  const clientOptions = {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.spawnFn === undefined ? {} : { spawnFn: options.spawnFn }),
  };
  const cache = new Map<string, CachedTools>();
  /** Bearer tokens by server id, loaded from the secret bridge; never logged. */
  const tokens = new Map<string, string>();

  function secretKey(id: string): string {
    return `mcp:${id}`;
  }

  async function tokenFor(server: McpServer): Promise<string | null> {
    if (!server.hasSecret) return null;
    const cached = tokens.get(server.id);
    if (cached !== undefined) return cached;
    const ref = repos.mcp.secretRef(server.id);
    if (ref === null || options.secrets === undefined) return null;
    const value = await options.secrets.get(ref).catch(() => null);
    if (value !== null && value.length > 0) tokens.set(server.id, value);
    return value;
  }

  function authHeaders(token: string | null): Record<string, string> {
    return token === null || token.length === 0 ? {} : { authorization: `Bearer ${token}` };
  }

  function requireServer(id: string): McpServer {
    const server = repos.mcp.get(id);
    if (server === undefined) throw notFound(`MCP server not found: ${id}`);
    return server;
  }

  async function connected<T>(server: McpServer, run: (client: McpClient) => Promise<T>): Promise<T> {
    const client =
      server.transport === 'http'
        ? createHttpMcpClient({
            url: server.url ?? '',
            headers: authHeaders(await tokenFor(server)),
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
          })
        : createMcpClient(
            server.hasSecret ? { ...server, env: { ...server.env, ...secretEnvOf(await tokenFor(server)) } } : server,
            clientOptions,
          );
    try {
      await client.initialize();
      return await run(client);
    } finally {
      await client.close();
    }
  }

  return {
    list: () => repos.mcp.list(),

    upsert: (input) => {
      const server = repos.mcp.upsert(input);
      cache.delete(server.id);
      return server;
    },

    save: async (input) => {
      const transport = input.transport ?? 'stdio';
      if (transport === 'http') {
        validateMcpUrl(input.url ?? '');
      } else if ((input.command ?? '').trim().length === 0 && input.id === undefined) {
        throw badRequest('a stdio server needs a command');
      }
      const { secret: token, secretEnv, ...row } = input;
      const secret =
        transport === 'stdio' && secretEnv !== undefined && Object.keys(secretEnv).length > 0
          ? JSON.stringify(secretEnv)
          : token;
      // Refuse before writing anything, so a missing bridge never leaves a half-made row.
      if (secret !== undefined && secret.length > 0 && options.secrets === undefined) {
        throw badRequest('secret storage is unavailable');
      }
      const server = repos.mcp.upsert(row);
      cache.delete(server.id);
      if (secret !== undefined && secret.length > 0 && options.secrets !== undefined) {
        const ref = secretKey(server.id);
        await options.secrets.set(ref, secret);
        tokens.set(server.id, secret);
        return repos.mcp.upsert({ id: server.id, label: server.label, secretRef: ref });
      }
      return server;
    },

    launchMap: () => {
      const enabled = repos.mcp.list().filter((server) => server.enabled);
      const counts = new Map<string, number>();
      for (const server of enabled) counts.set(server.label, (counts.get(server.label) ?? 0) + 1);
      const launches: Record<string, McpServerLaunch> = {};
      for (const server of enabled) {
        const key = (counts.get(server.label) ?? 0) > 1 ? `${server.label}-${server.id}` : server.label;
        launches[key] =
          server.transport === 'http'
            ? { type: 'http', url: server.url ?? '', headers: authHeaders(tokens.get(server.id) ?? null) }
            : {
                command: server.command,
                args: server.args,
                env: { ...server.env, ...secretEnvOf(tokens.get(server.id) ?? null) },
              };
      }
      return launches;
    },

    warmSecrets: async () => {
      for (const server of repos.mcp.list()) {
        if (server.hasSecret) await tokenFor(server);
      }
    },

    remove: (id) => {
      const ref = repos.mcp.secretRef(id);
      repos.mcp.remove(id);
      cache.delete(id);
      tokens.delete(id);
      // The bridge has no delete; blanking the value retires the token.
      if (ref !== null) void options.secrets?.set(ref, '').catch(() => undefined);
    },

    test: async (id) => {
      cache.delete(id);
      const server = repos.mcp.get(id);
      if (server === undefined) {
        return { ok: false, detail: `MCP server not found: ${id}`, tools: [] };
      }
      try {
        const tools = await connected(server, (client) => client.listTools());
        cache.set(id, { tools, at: now() });
        return { ok: true, detail: 'Connected', tools };
      } catch (error) {
        return { ok: false, detail: failure(error), tools: [] };
      }
    },

    listTools: async (id) => {
      const server = requireServer(id);
      const cached = cache.get(id);
      if (cached !== undefined && now() - cached.at < MCP_TOOL_CACHE_TTL_MS) return cached.tools;
      const tools = await connected(server, (client) => client.listTools());
      cache.set(id, { tools, at: now() });
      return tools;
    },

    callTool: async (id, tool, args) => {
      const server = requireServer(id);
      if (!server.enabled) throw badRequest(`MCP server is disabled: ${server.label}`);
      return connected(server, (client) => client.callTool(tool, args));
    },
  };
}
