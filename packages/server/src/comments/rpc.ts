import type { RpcParams } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import { addReviewComment, listReviewComments, resolveReviewComment } from './service.js';

export interface CommentHandlerDeps {
  repos: Repos;
}

/** RPC handlers for inline review comments on a thread's diff. */
export function createCommentHandlers(deps: CommentHandlerDeps): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('comments.list', (params) =>
    listReviewComments(deps.repos, (params as RpcParams<'comments.list'>).threadId),
  );
  handlers.set('comments.add', (params) =>
    addReviewComment(deps.repos, params as RpcParams<'comments.add'>),
  );
  handlers.set('comments.resolve', (params) => {
    const { id, resolved } = params as RpcParams<'comments.resolve'>;
    return resolveReviewComment(deps.repos, id, resolved);
  });
  return handlers;
}
