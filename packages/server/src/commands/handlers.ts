import type { RpcParams } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import { listCommands } from './discover.js';

export interface CommandHandlerDeps {
  repos: Repos;
  bus?: EventBus;
}

function warningSink(bus: EventBus | undefined): ((message: string) => void) | undefined {
  if (bus === undefined) return undefined;
  return (message) => {
    bus.emit({ kind: 'event', type: 'server.warning', payload: { message, code: 'commands' } });
  };
}

/** RPC handlers for `commands.list`; merged into the server registry at startup. */
export function createCommandHandlers(deps: CommandHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('commands.list', (params) => {
    const { projectId } = params as RpcParams<'commands.list'>;
    const project = deps.repos.projects.get(projectId);
    if (project === undefined) throw notFound('project not found');
    return listCommands(project.path, { onWarning: warningSink(deps.bus) });
  });
  return handlers;
}
