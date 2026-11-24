import type { RpcParams } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { notFound } from '../errors.js';
import { planPrompt } from '../prompt/service.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import { getThread } from '../threads.js';
import { measureContext } from './service.js';

export interface ContextHandlerDeps {
  repos: Repos;
}

/**
 * `threads.context` recomputes usage on demand with the same planner and estimator the
 * runner uses, so the composer meter cannot drift from what the next turn will send.
 * The thread's last user message stands in for the next turn's message; its row is
 * excluded from the conversation estimate because the prompt already carries it.
 */
export function createContextHandlers(deps: ContextHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('threads.context', (params) => {
    const { threadId } = params as RpcParams<'threads.context'>;
    const thread = getThread(deps.repos, threadId);
    const project = deps.repos.projects.get(thread.projectId);
    if (project === undefined) throw notFound('project not found');
    const messages = deps.repos.messages.list(thread.id);
    const lastUser = messages.findLast((message) => message.role === 'user');
    const { assembly } = planPrompt(deps.repos, {
      thread,
      project,
      message: lastUser?.content ?? '',
      settings: deps.repos.settings.get(),
    });
    const usage = measureContext(
      deps.repos,
      thread,
      assembly.sections,
      lastUser === undefined ? {} : { excludeMessageId: lastUser.id },
    );
    return {
      usedTokens: usage.usedTokens,
      maxTokens: usage.maxTokens,
      percent: usage.percent,
      segments: usage.segments,
    };
  });
  return handlers;
}
