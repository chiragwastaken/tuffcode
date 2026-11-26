import type { McpAuthMode, McpServer, McpServerLaunch, McpTool } from '@tuffcode/contracts';
import type { McpRepo, UpsertMcpServerInput } from '../db/repos/index.js';
import { badRequest, notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import type { Secrets } from '../secrets/bridge.js';
import { createMcpClient, type McpClient, type McpSpawnFn } from './client.js';
import {
  createHttpMcpClient,
  McpAuthRequiredError,
  validateMcpUrl,
  type HttpMcpAuthProvider,
  type McpFetch,
} from './http-client.js';
import {
  createOAuthManager,
  secretKeyFor,
  type OAuthFlowStart,
  type OAuthManager,
  type OAuthStartInput,
  type OAuthStatus,
} from './oauth.js';

/**
 * The MCP service owns the configured servers, the 60s tool cache, connector auth and
 * the two agent-facing operations. Every call opens its own short-lived client; the
 * cache keeps repeated `tools/list` calls from spawning a child each turn.
 *
 * Credentials live in the OS keychain under `mcp:<id>`: a header value for bearer mode,
 * one JSON token bundle for OAuth. The database keeps only `secret_ref` and `authMode`.
 */
export const MCP_TOOL_CACHE_TTL_MS = 60_000;

export interface McpServiceRepos {
  mcp: McpRepo;
}

export interface McpServiceOptions {
  timeoutMs?: number;
  spawnFn?: McpSpawnFn;
  now?: () => number;
  /** Holds connector credentials; absent means http servers run without them. */
  secrets?: Pick<Secrets, 'get' | 'set'>;
  fetchFn?: McpFetch;
  /** Receives `mcp.updated` so Settings and the plugin dialog refresh live. */
  bus?: EventBus;
  /** Test seam for the OAuth loopback timeout. */
  oauthCallbackTimeoutMs?: number;
}

/**
 * What the settings form and the plugin installer send: a row plus an optional secret.
 * For an http server the secret is the credential value; `secretPrefix` is prepended to
 * it before storage (for example "Bearer "). For a stdio server it is a map of secret
 * environment variables merged into the child's env at launch. Either way it lives in
 * the secret bridge, never in the database.
 */
export type UpsertMcpWithSecretInput = Omit<UpsertMcpServerInput, 'secretRef'> & {
  secret?: string;
  secretPrefix?: string;
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
  /** True when the connector needs an interactive OAuth sign-in. */
  needsAuth?: boolean;
}

export interface McpService {
  list(): McpServer[];
  upsert(input: UpsertMcpServerInput): McpServer;
  /** Validates the transport, stores the credential in the secret bridge, then writes the row. */
  save(input: UpsertMcpWithSecretInput): Promise<McpServer>;
  /** Enabled servers as vendor CLIs launch them, keyed by a unique label. Sync for the SDK. */
  launchMap(): Record<string, McpServerLaunch>;
  /** Loads stored credentials into memory so `launchMap` can attach them synchronously. */
  warmSecrets(): Promise<void>;
  /**
   * Drops the 60s tool cache and re-reads stored credentials, so a reload or a
   * credential change reaches the next turn without a restart. Does not reconnect.
   */
  invalidate(): Promise<void>;
  remove(id: string): void;
  test(id: string): Promise<McpTestResult>;
  listTools(id: string): Promise<McpTool[]>;
  callTool(id: string, tool: string, args: Record<string, unknown>): Promise<string>;
  /** Starts an OAuth 2.1 PKCE flow; the renderer opens `authorizeUrl` in the browser. */
  oauthStart(id: string, input?: OAuthStartInput): Promise<OAuthFlowStart>;
  oauthStatus(id: string): Promise<OAuthStatus>;
  oauthDisconnect(id: string): Promise<void>;
  dispose(): void;
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
  /** Bearer header values by server id, loaded from the secret bridge; never logged. */
  const tokens = new Map<string, string>();

  function emit(server: McpServer | undefined): void {
    if (server === undefined || options.bus === undefined) return;
    options.bus.emit({ kind: 'event', type: 'mcp.updated', payload: server });
  }

  const oauth: OAuthManager = createOAuthManager({
    // Without a bridge OAuth cannot persist a bundle, so it stays unavailable.
    secrets: options.secrets ?? { get: () => Promise.resolve(null), set: () => Promise.resolve() },
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    now,
    ...(options.oauthCallbackTimeoutMs === undefined
      ? {}
      : { callbackTimeoutMs: options.oauthCallbackTimeoutMs }),
    onUpdate: (serverId) => emit(repos.mcp.get(serverId)),
  });

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

  /** How one http connector authenticates; undefined means no credential is attached. */
  function httpAuth(server: McpServer): HttpMcpAuthProvider | undefined {
    if (server.transport !== 'http' || server.authMode === 'none') return undefined;
    if (server.authMode === 'oauth') {
      return {
        headers: async () => {
          const value = await oauth.headerValue(server);
          return value === null ? {} : { [server.authHeader]: value };
        },
        refresh: () => oauth.refresh(server),
      };
    }
    return {
      headers: async () => {
        const value = await tokenFor(server);
        return value === null ? {} : { [server.authHeader]: value };
      },
    };
  }

  function requireServer(id: string): McpServer {
    const server = repos.mcp.get(id);
    if (server === undefined) throw notFound(`MCP server not found: ${id}`);
    return server;
  }

  async function connected<T>(server: McpServer, run: (client: McpClient) => Promise<T>): Promise<T> {
    let client: McpClient;
    if (server.transport === 'http') {
      const auth = httpAuth(server);
      client = createHttpMcpClient({
        url: server.url ?? '',
        ...(auth === undefined ? {} : { auth }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      });
    } else {
      const env = server.hasSecret ? { ...server.env, ...secretEnvOf(await tokenFor(server)) } : server.env;
      client = createMcpClient({ ...server, env }, clientOptions);
    }
    try {
      await client.initialize();
      return await run(client);
    } finally {
      await client.close();
    }
  }

  /** Reads every stored connector credential into memory; shared by warm and invalidate. */
  async function warmCredentials(): Promise<void> {
    for (const server of repos.mcp.list()) {
      if (server.authMode === 'oauth') await oauth.warm(server);
      else if (server.hasSecret) await tokenFor(server);
    }
  }

  return {
    list: () => repos.mcp.list(),

    upsert: (input) => {
      const server = repos.mcp.upsert(input);
      cache.delete(server.id);
      emit(server);
      return server;
    },

    save: async (input) => {
      const transport = input.transport ?? 'stdio';
      if (transport === 'http') {
        validateMcpUrl(input.url ?? '');
      } else if ((input.command ?? '').trim().length === 0 && input.id === undefined) {
        throw badRequest('a stdio server needs a command');
      }
      const existing = input.id === undefined ? undefined : repos.mcp.get(input.id);
      const { secret, secretPrefix, secretEnv, ...row } = input;
      const authMode: McpAuthMode =
        transport === 'stdio'
          ? 'none'
          : (row.authMode ??
            (secret !== undefined && secret.length > 0 ? 'bearer' : (existing?.authMode ?? 'none')));
      const credential =
        transport === 'stdio' && secretEnv !== undefined && Object.keys(secretEnv).length > 0
          ? JSON.stringify(secretEnv)
          : transport === 'http' && authMode === 'bearer' && secret !== undefined && secret.length > 0
            ? `${secretPrefix ?? ''}${secret}`
            : undefined;
      // Refuse before writing anything, so a missing bridge never leaves a half-made row.
      if (credential !== undefined && credential.length > 0 && options.secrets === undefined) {
        throw badRequest('secret storage is unavailable');
      }
      // Changing the mode invalidates the stored credential, which belonged to the old one.
      const modeChanged = row.authMode !== undefined && existing !== undefined && row.authMode !== existing.authMode;
      const clearSecret = modeChanged && (credential === undefined || credential.length === 0);
      const server = repos.mcp.upsert({
        ...row,
        authMode,
        ...(clearSecret ? { secretRef: null } : {}),
      });
      cache.delete(server.id);
      tokens.delete(server.id);
      if (clearSecret) {
        await options.secrets?.set(secretKeyFor(server.id), '').catch(() => undefined);
      }
      if (credential !== undefined && credential.length > 0 && options.secrets !== undefined) {
        const ref = secretKeyFor(server.id);
        await options.secrets.set(ref, credential);
        tokens.set(server.id, credential);
        const stored = repos.mcp.upsert({
          id: server.id,
          label: server.label,
          authMode,
          secretRef: ref,
        });
        emit(stored);
        return stored;
      }
      emit(server);
      return server;
    },

    launchMap: () => {
      const enabled = repos.mcp.list().filter((server) => server.enabled);
      const counts = new Map<string, number>();
      for (const server of enabled) counts.set(server.label, (counts.get(server.label) ?? 0) + 1);
      const launches: Record<string, McpServerLaunch> = {};
      for (const server of enabled) {
        const key = (counts.get(server.label) ?? 0) > 1 ? `${server.label}-${server.id}` : server.label;
        if (server.transport === 'http') {
          const value =
            server.authMode === 'oauth' ? oauth.cachedHeaderValue(server) : (tokens.get(server.id) ?? null);
          launches[key] = {
            type: 'http',
            url: server.url ?? '',
            headers: value === null ? {} : { [server.authHeader]: value },
          };
          continue;
        }
        launches[key] = {
          command: server.command,
          args: server.args,
          env: { ...server.env, ...secretEnvOf(tokens.get(server.id) ?? null) },
        };
      }
      return launches;
    },

    warmSecrets: warmCredentials,

    invalidate: async () => {
      cache.clear();
      tokens.clear();
      await warmCredentials();
    },

    remove: (id) => {
      const removed = repos.mcp.get(id);
      const ref = repos.mcp.secretRef(id);
      repos.mcp.remove(id);
      cache.delete(id);
      tokens.delete(id);
      // The bridge has no delete; blanking the value retires the credential.
      if (ref !== null) void options.secrets?.set(ref, '').catch(() => undefined);
      emit(removed);
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
        return {
          ok: false,
          detail: failure(error),
          tools: [],
          ...(error instanceof McpAuthRequiredError ? { needsAuth: true } : {}),
        };
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

    oauthStart: async (id, input) => {
      const server = requireServer(id);
      if (server.transport !== 'http') throw badRequest('OAuth applies to http connectors only');
      return oauth.start(server, input);
    },

    oauthStatus: (id) => oauth.status(requireServer(id)),

    oauthDisconnect: async (id) => {
      const server = requireServer(id);
      await oauth.disconnect(server);
      tokens.delete(id);
      cache.delete(id);
      const cleared = repos.mcp.upsert({ id: server.id, label: server.label, secretRef: null });
      emit(cleared);
    },

    dispose: () => {
      oauth.dispose();
    },
  };
}
