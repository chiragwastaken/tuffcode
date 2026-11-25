import type { McpServer, McpTool } from '@tuffcode/contracts';
import type { McpRepo, UpsertMcpServerInput } from '../db/repos/index.js';
import { badRequest, notFound } from '../errors.js';
import { createMcpClient, type McpClient, type McpSpawnFn } from './client.js';

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
}

export interface McpTestResult {
  ok: boolean;
  detail: string;
  tools: McpTool[];
}

export interface McpService {
  list(): McpServer[];
  upsert(input: UpsertMcpServerInput): McpServer;
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

  function requireServer(id: string): McpServer {
    const server = repos.mcp.get(id);
    if (server === undefined) throw notFound(`MCP server not found: ${id}`);
    return server;
  }

  async function connected<T>(server: McpServer, run: (client: McpClient) => Promise<T>): Promise<T> {
    const client = createMcpClient(server, clientOptions);
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

    remove: (id) => {
      repos.mcp.remove(id);
      cache.delete(id);
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
