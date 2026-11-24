import { existsSync } from 'node:fs';
import type { Thread } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import { conflict, notFound } from '../errors.js';

export interface WorktreeContext {
  thread: Thread;
  worktreePath: string;
}

/**
 * Loads a thread and its worktree path, rejecting threads that have no checkout on
 * disk. Every git operation needs this pair; keeping it in one place means the error
 * codes stay consistent.
 */
export function requireWorktree(repos: Repos, threadId: string): WorktreeContext {
  const thread = repos.threads.get(threadId);
  if (thread === undefined) throw notFound('thread not found');
  if (thread.worktreePath === null) throw conflict('thread has no worktree');
  if (!existsSync(thread.worktreePath)) throw conflict('thread worktree is missing');
  return { thread, worktreePath: thread.worktreePath };
}
