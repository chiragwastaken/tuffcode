import type { RpcParams } from '@tuffcode/contracts';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { Subagents } from './types.js';

export interface SubagentHandlerDeps {
  subagents: Subagents;
}

/**
 * RPC handlers for typed subagents. `subagents.spawn` persists the child as queued
 * and returns before it runs; progress arrives as `subagent.started`, `subagent.event`
 * and `subagent.finished` on the parent thread.
 */
export function createSubagentHandlers(deps: SubagentHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('subagents.spawn', (params) => {
    const { threadId, spec } = params as RpcParams<'subagents.spawn'>;
    return deps.subagents.spawn({ threadId, spec });
  });
  handlers.set('subagents.cancel', async (params) => {
    const { childId } = params as RpcParams<'subagents.cancel'>;
    await deps.subagents.cancel(childId);
    return {};
  });
  handlers.set('subagents.list', (params) =>
    deps.subagents.list((params as RpcParams<'subagents.list'>).threadId),
  );
  handlers.set('subagents.listAll', () => deps.subagents.listAll());
  return handlers;
}
