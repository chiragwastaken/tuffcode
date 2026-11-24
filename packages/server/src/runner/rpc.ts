import type { RpcParams } from '@tuffcode/contracts';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { Runner } from './runner.js';

export interface RunnerHandlerDeps {
  runner: Runner;
}

/**
 * RPC handlers for turns. `threads.send` returns the turn id as soon as the row
 * exists; the run streams over the event bus, so this handler never awaits a turn.
 */
export function createRunnerHandlers(deps: RunnerHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('threads.send', (params) => {
    const { id, text, attachments } = params as RpcParams<'threads.send'>;
    return deps.runner.send(id, text, attachments ?? []);
  });
  handlers.set('threads.interrupt', async (params) => {
    const { id } = params as RpcParams<'threads.interrupt'>;
    await deps.runner.interrupt(id);
    return {};
  });
  handlers.set('threads.approve', async (params) => {
    const { threadId, approvalId, decision } = params as RpcParams<'threads.approve'>;
    await deps.runner.approve(threadId, approvalId, decision);
    return {};
  });
  return handlers;
}
