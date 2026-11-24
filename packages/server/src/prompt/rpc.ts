import type { RpcParams } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { notFound } from '../errors.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import { getThread } from '../threads.js';
import { planPrompt } from './service.js';

export interface PromptHandlerDeps {
  repos: Repos;
}

/**
 * `prompt.preview` runs the same planner as `threads.send`, so the sections and token
 * counts shown in the UI cannot drift from the assembled turn.
 */
export function createPromptHandlers(deps: PromptHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('prompt.preview', (params) => {
    const { threadId, message } = params as RpcParams<'prompt.preview'>;
    const thread = getThread(deps.repos, threadId);
    const project = deps.repos.projects.get(thread.projectId);
    if (project === undefined) throw notFound('project not found');
    const { assembly } = planPrompt(deps.repos, {
      thread,
      project,
      message,
      settings: deps.repos.settings.get(),
    });
    return { sections: assembly.sections, total: assembly.total };
  });
  return handlers;
}
