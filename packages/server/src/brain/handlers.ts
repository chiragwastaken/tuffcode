import type { ExecutionMode, RpcParams, RpcResult } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { badRequest, notFound } from '../errors.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import { assembleBrain } from './service.js';
import { createBrainStore, type BrainStore } from './store.js';

export interface BrainHandlerDeps {
  repos: Repos;
}

export interface BrainHandlers {
  'brain.list': (params: RpcParams<'brain.list'>) => RpcResult<'brain.list'>;
  'brain.upsert': (params: RpcParams<'brain.upsert'>) => RpcResult<'brain.upsert'>;
  'brain.delete': (params: RpcParams<'brain.delete'>) => RpcResult<'brain.delete'>;
  'brain.preview': (params: RpcParams<'brain.preview'>) => RpcResult<'brain.preview'>;
  'brain.link': (params: RpcParams<'brain.link'>) => RpcResult<'brain.link'>;
}

/**
 * RPC handlers for the brain inspector. `brain.preview` runs the same assembly the
 * turn runner uses, so the inspector shows exactly what the next send injects.
 */
export function createBrainHandlers(deps: BrainHandlerDeps): BrainHandlers {
  const store: BrainStore = createBrainStore(deps.repos.brain);

  return {
    'brain.list': (params) => store.list(params),
    'brain.upsert': (params) => store.upsert(params),
    'brain.delete': ({ id }) => {
      if (store.get(id) === undefined) throw notFound('brain entry not found');
      store.remove(id);
      return {};
    },
    'brain.preview': ({ projectId, threadId, message }) => {
      let turnMode: ExecutionMode | undefined;
      if (threadId !== undefined) {
        const thread = deps.repos.threads.get(threadId);
        if (thread === undefined) throw notFound('thread not found');
        if (thread.projectId !== projectId) {
          throw badRequest('thread does not belong to project');
        }
        turnMode = thread.executionMode;
      }
      const assembly = assembleBrain(deps.repos, deps.repos.settings.get(), {
        projectId,
        ...(threadId === undefined ? {} : { threadId }),
        message,
        ...(turnMode === undefined ? {} : { mode: turnMode }),
      });
      return assembly.slice;
    },
    'brain.link': ({ fromId, toId, relation }) => {
      if (fromId === toId) throw badRequest('cannot link a brain entry to itself');
      if (store.get(fromId) === undefined) throw notFound(`brain entry not found: ${fromId}`);
      if (store.get(toId) === undefined) throw notFound(`brain entry not found: ${toId}`);
      deps.repos.brain.upsertEdge({ from: fromId, to: toId, relation });
      return {};
    },
  };
}

/** The same handlers as an RPC registry map, for the server's merge seam. */
export function createBrainRpcHandlers(deps: BrainHandlerDeps): RpcHandlers {
  const handlers = createBrainHandlers(deps);
  const map = new Map<string, RpcHandler>();
  map.set('brain.list', (params) => handlers['brain.list'](params as RpcParams<'brain.list'>));
  map.set('brain.upsert', (params) => handlers['brain.upsert'](params as RpcParams<'brain.upsert'>));
  map.set('brain.delete', (params) => handlers['brain.delete'](params as RpcParams<'brain.delete'>));
  map.set('brain.preview', (params) =>
    handlers['brain.preview'](params as RpcParams<'brain.preview'>),
  );
  map.set('brain.link', (params) => handlers['brain.link'](params as RpcParams<'brain.link'>));
  map.set('brain.reset', (params) => {
    const { projectId } = params as RpcParams<'brain.reset'>;
    return { removed: deps.repos.transaction(() => deps.repos.brain.removeAll(projectId)) };
  });
  return map;
}
