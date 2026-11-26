import type { RpcParams } from '@tuffcode/contracts';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { McpService } from './service.js';

/** The server's feature-registration seam; the glue slice passes `register`. */
export type McpRpcRegister = (handlers: RpcHandlers) => void;

/**
 * RPC handlers for the MCP settings section. `mcp.test` never throws, so the
 * settings form can show a failed connection without an error toast.
 */
export function registerMcpRpc(register: McpRpcRegister, service: McpService): void {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('mcp.list', () => service.list());
  handlers.set('mcp.upsert', (params) => service.save(params as RpcParams<'mcp.upsert'>));
  handlers.set('mcp.remove', (params) => {
    service.remove((params as RpcParams<'mcp.remove'>).id);
    return {};
  });
  handlers.set('mcp.test', (params) => service.test((params as RpcParams<'mcp.test'>).id));
  handlers.set('mcp.oauth.start', (params) => {
    const input = params as RpcParams<'mcp.oauth.start'>;
    return service.oauthStart(input.id, {
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      ...(input.clientSecret === undefined ? {} : { clientSecret: input.clientSecret }),
    });
  });
  handlers.set('mcp.oauth.status', (params) =>
    service.oauthStatus((params as RpcParams<'mcp.oauth.status'>).id),
  );
  handlers.set('mcp.oauth.disconnect', async (params) => {
    await service.oauthDisconnect((params as RpcParams<'mcp.oauth.disconnect'>).id);
    return {};
  });
  register(handlers);
}
