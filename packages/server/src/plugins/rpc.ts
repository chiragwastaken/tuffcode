import type { RpcParams } from '@tuffcode/contracts';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { PluginsService } from './service.js';

/** RPC handlers for the Plugins hub and the Connectors tab. */
export function createPluginHandlers(deps: { plugins: PluginsService }): RpcHandlers {
  const { plugins } = deps;
  const handlers = new Map<string, RpcHandler>();
  handlers.set('plugins.marketplaces', () => plugins.marketplaces());
  handlers.set('plugins.addMarketplace', (params) =>
    plugins.addMarketplace((params as RpcParams<'plugins.addMarketplace'>).url),
  );
  handlers.set('plugins.removeMarketplace', (params) => {
    plugins.removeMarketplace((params as RpcParams<'plugins.removeMarketplace'>).id);
    return {};
  });
  handlers.set('plugins.catalog', (params) => {
    const { marketplaceId, refresh } = params as RpcParams<'plugins.catalog'>;
    return plugins.catalog({
      ...(marketplaceId === undefined ? {} : { marketplaceId }),
      ...(refresh === undefined ? {} : { refresh }),
    });
  });
  handlers.set('plugins.installed', () => plugins.installed());
  handlers.set('plugins.install', (params) =>
    plugins.install((params as RpcParams<'plugins.install'>).entryId),
  );
  handlers.set('plugins.upload', (params) =>
    plugins.upload((params as RpcParams<'plugins.upload'>).path),
  );
  handlers.set('plugins.setEnabled', (params) => {
    const { id, enabled } = params as RpcParams<'plugins.setEnabled'>;
    return plugins.setEnabled(id, enabled);
  });
  handlers.set('plugins.remove', async (params) => {
    await plugins.remove((params as RpcParams<'plugins.remove'>).id);
    return {};
  });
  handlers.set('connectors.search', (params) =>
    plugins.searchConnectors((params as RpcParams<'connectors.search'>).query),
  );
  handlers.set('connectors.install', (params) => {
    const { entry, env, secret } = params as RpcParams<'connectors.install'>;
    return plugins.installConnector({
      entry,
      ...(env === undefined ? {} : { env }),
      ...(secret === undefined ? {} : { secret }),
    });
  });
  return handlers;
}
