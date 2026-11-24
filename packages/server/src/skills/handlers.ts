import type { RpcParams, Skill } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import { discoverSkills } from './discover.js';

export interface SkillHandlerDeps {
  repos: Repos;
  bus?: EventBus;
}

function warningSink(bus: EventBus | undefined): ((message: string) => void) | undefined {
  if (bus === undefined) return undefined;
  return (message) => {
    bus.emit({ kind: 'event', type: 'server.warning', payload: { message, code: 'skills' } });
  };
}

/**
 * RPC handlers for `skills.list`. The contract row carries a body field, so list
 * rows set it to an empty string; the body is only read by `loadSkill`.
 */
export function createSkillHandlers(deps: SkillHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('skills.list', (params) => {
    const { projectId } = params as RpcParams<'skills.list'>;
    const project = deps.repos.projects.get(projectId);
    if (project === undefined) throw notFound('project not found');
    return discoverSkills(project.path, { onWarning: warningSink(deps.bus) }).map(
      (skill): Skill => ({ ...skill, body: '' }),
    );
  });
  return handlers;
}
