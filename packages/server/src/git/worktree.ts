import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInside, normalizePath } from '@tuffcode/shared';
import { badRequest, conflict } from '../errors.js';
import { runGit, tryRunGit } from './runGit.js';

export interface ProvisionWorktreeInput {
  repoPath: string;
  baseBranch: string;
  projectId: string;
  threadId: string;
  worktreesRoot: string;
}

export interface ProvisionedWorktree {
  path: string;
  branch: string;
  baseBranch: string;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await tryRunGit(['rev-parse', '--is-inside-work-tree'], dir);
  return result.ok && result.stdout.trim() === 'true';
}

/** Absolute repository root for `dir`, or null when it is not inside a work tree. */
export async function repoRoot(dir: string): Promise<string | null> {
  const result = await tryRunGit(['rev-parse', '--show-toplevel'], dir);
  if (!result.ok) return null;
  const root = result.stdout.trim();
  return root.length === 0 ? null : normalizePath(root);
}

/** Current branch name, or null for a detached HEAD. */
export async function currentBranch(cwd: string): Promise<string | null> {
  const result = await tryRunGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  if (!result.ok) return null;
  const branch = result.stdout.trim();
  return branch.length === 0 ? null : branch;
}

/**
 * Resolves a base branch to something `git worktree add` accepts: the local branch
 * when it exists, otherwise `origin/<branch>`.
 */
export async function resolveBaseRef(cwd: string, branch: string): Promise<string> {
  const local = await tryRunGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
  if (local.ok) return branch;
  const remote = await tryRunGit(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
    cwd,
  );
  if (remote.ok) return `origin/${branch}`;
  throw badRequest(`base branch not found: ${branch}`);
}

/**
 * The branch a project treats as its default: `origin/HEAD` when the remote is set,
 * otherwise the first of main/master that exists, otherwise the checked-out branch.
 */
export async function detectDefaultBranch(cwd: string): Promise<string> {
  const remoteHead = await tryRunGit(
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    cwd,
  );
  if (remoteHead.ok) {
    const value = remoteHead.stdout.trim();
    const slash = value.indexOf('/');
    if (slash >= 0 && slash < value.length - 1) return value.slice(slash + 1);
  }
  for (const candidate of ['main', 'master']) {
    const exists = await tryRunGit(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`],
      cwd,
    );
    if (exists.ok) return candidate;
  }
  return (await currentBranch(cwd)) ?? 'main';
}

/**
 * Creates `git worktree add -b tuffcode/<threadId> <worktreesRoot>/<projectId>/<threadId>
 * <base>` after validating the project is a git repository, the base branch exists and
 * the worktree root sits outside the project (worktrees never land inside the repo).
 */
export async function provisionWorktree(
  input: ProvisionWorktreeInput,
): Promise<ProvisionedWorktree> {
  if (!(await isGitRepo(input.repoPath))) {
    throw badRequest('project is not a git repository');
  }
  const root = resolve(normalizePath(input.worktreesRoot));
  if (isInside(input.repoPath, root)) {
    throw badRequest('worktree root must be outside the project');
  }
  const target = join(root, input.projectId, input.threadId);
  if (isInside(input.repoPath, target)) {
    throw badRequest('worktree path must be outside the project');
  }
  if (existsSync(target)) {
    throw conflict('worktree path already exists');
  }
  const branch = `tuffcode/${input.threadId}`;
  const startPoint = await resolveBaseRef(input.repoPath, input.baseBranch);
  await runGit(['worktree', 'add', '-b', branch, target, startPoint], input.repoPath);
  return { path: target, branch, baseBranch: input.baseBranch };
}

/**
 * Removes a worktree: `git worktree remove --force`, a filesystem fallback when git
 * refuses (for example after the directory was already partly deleted), then
 * `git worktree prune` so the repository stops listing it.
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const target = resolve(normalizePath(worktreePath));
  const removed = await tryRunGit(['worktree', 'remove', '--force', target], repoPath);
  if (!removed.ok && existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  await tryRunGit(['worktree', 'prune'], repoPath);
}
