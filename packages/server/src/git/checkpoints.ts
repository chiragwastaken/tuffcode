import type { Checkpoint } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import type { Repos } from '../db/repos/index.js';
import { badRequest, notFound, RpcError } from '../errors.js';
import { requireWorktree } from './context.js';
import { runGit } from './runGit.js';

/**
 * Snapshots the worktree: `git stash create` builds a commit of the current changes
 * (or an empty string when the tree is clean, in which case HEAD is the snapshot),
 * then `git update-ref refs/tuffcode/<threadId>/<id>` keeps that commit reachable.
 */
export async function createCheckpoint(
  repos: Repos,
  threadId: string,
  label: string,
): Promise<Checkpoint> {
  const trimmed = label.trim();
  if (trimmed.length === 0) throw badRequest('checkpoint label is required');
  const { worktreePath } = requireWorktree(repos, threadId);
  const stashed = (await runGit(['stash', 'create'], worktreePath)).trim();
  const commitSha =
    stashed.length > 0 ? stashed : (await runGit(['rev-parse', 'HEAD'], worktreePath)).trim();
  const id = newId('ckp');
  const ref = `refs/tuffcode/${threadId}/${id}`;
  await runGit(['update-ref', ref, commitSha], worktreePath);
  return repos.checkpoints.create({
    id,
    threadId,
    ref,
    label: trimmed,
    commitSha,
    createdAt: new Date().toISOString(),
  });
}

export function listCheckpoints(repos: Repos, threadId: string): Checkpoint[] {
  if (repos.threads.get(threadId) === undefined) throw notFound('thread not found');
  return repos.checkpoints.list(threadId);
}

/**
 * Restores the worktree to a checkpoint. Destructive by design, so it refuses unless
 * the caller passes `confirm`. `git reset --hard` restores tracked content; `git clean
 * -fd` removes files created after the snapshot.
 */
export async function revertCheckpoint(
  repos: Repos,
  threadId: string,
  checkpointId: string,
  confirm: boolean,
): Promise<void> {
  if (!confirm) {
    throw new RpcError('permission-denied', 'revert requires confirmation');
  }
  const { worktreePath } = requireWorktree(repos, threadId);
  const checkpoint = repos.checkpoints.get(checkpointId);
  if (checkpoint === undefined || checkpoint.threadId !== threadId) {
    throw notFound('checkpoint not found');
  }
  await runGit(['reset', '--hard', checkpoint.commitSha], worktreePath);
  await runGit(['clean', '-fd'], worktreePath);
}
