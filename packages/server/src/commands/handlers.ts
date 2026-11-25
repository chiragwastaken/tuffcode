import type { RpcParams } from '@tuffcode/contracts';
import type { Council } from '../council/types.js';
import type { Repos } from '../db/repos/index.js';
import { notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { Runner } from '../runner/runner.js';
import type { Subagents } from '../subagents/types.js';
import { pluginCommandDirs } from '../skills/roots.js';
import { listCommands } from './discover.js';
import { runCommand } from './run.js';

export interface CommandHandlerDeps {
  repos: Repos;
  bus?: EventBus;
  /** Absent when the slice is not wired; the matching commands report unavailable. */
  council?: Council;
  subagents?: Subagents;
  runner?: Pick<Runner, 'disposeThread'>;
}

function warningSink(bus: EventBus | undefined): ((message: string) => void) | undefined {
  if (bus === undefined) return undefined;
  return (message) => {
    bus.emit({ kind: 'event', type: 'server.warning', payload: { message, code: 'commands' } });
  };
}

/** RPC handlers for `commands.list` and `commands.run`; merged into the registry. */
export function createCommandHandlers(deps: CommandHandlerDeps): RpcHandlers {
  const onWarning = warningSink(deps.bus);
  const handlers = new Map<string, RpcHandler>();
  handlers.set('commands.list', (params) => {
    const { projectId } = params as RpcParams<'commands.list'>;
    const project = deps.repos.projects.get(projectId);
    if (project === undefined) throw notFound('project not found');
    return listCommands(project.path, { onWarning, pluginDirs: pluginCommandDirs(deps.repos) });
  });
  handlers.set('commands.run', (params) => {
    const { threadId, input } = params as RpcParams<'commands.run'>;
    return runCommand(
      {
        repos: deps.repos,
        ...(deps.bus === undefined ? {} : { bus: deps.bus }),
        ...(deps.council === undefined ? {} : { council: deps.council }),
        ...(deps.subagents === undefined ? {} : { subagents: deps.subagents }),
        ...(deps.runner === undefined ? {} : { runner: deps.runner }),
        ...(onWarning === undefined ? {} : { onWarning }),
      },
      { threadId, input },
    );
  });
  return handlers;
}
