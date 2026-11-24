import type { RpcParams } from '@tuffcode/contracts';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { ProvidersService } from './service.js';

export interface ProviderHandlerDeps {
  providers: ProvidersService;
}

/** RPC handlers for the provider registry. Secrets never appear in any result. */
export function createProviderHandlers(deps: ProviderHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('providers.list', () => deps.providers.list());
  handlers.set('providers.upsert', (params) =>
    deps.providers.upsert(params as RpcParams<'providers.upsert'>),
  );
  handlers.set('providers.remove', async (params) => {
    const { id } = params as RpcParams<'providers.remove'>;
    await deps.providers.remove(id);
    return {};
  });
  handlers.set('providers.test', (params) =>
    deps.providers.test((params as RpcParams<'providers.test'>).id),
  );
  handlers.set('models.list', (params) =>
    deps.providers.listModels((params as RpcParams<'models.list'>).providerId),
  );
  handlers.set('providers.models', (params) => {
    const { providerId, refresh } = params as RpcParams<'providers.models'>;
    return deps.providers.models(providerId, refresh === true);
  });
  handlers.set('providers.login', (params) =>
    deps.providers.login((params as RpcParams<'providers.login'>).id),
  );
  handlers.set('providers.loginCancel', async (params) => {
    await deps.providers.cancelLogin((params as RpcParams<'providers.loginCancel'>).loginId);
    return {};
  });
  return handlers;
}
