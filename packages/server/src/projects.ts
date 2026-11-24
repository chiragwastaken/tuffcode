import { existsSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Project } from '@tuffcode/contracts';
import { newId, worktreesRoot } from '@tuffcode/shared';
import type { Repos } from './db/repos/index.js';
import { badRequest, conflict, notFound } from './errors.js';
import { detectDefaultBranch, removeWorktree, repoRoot } from './git/worktree.js';

/**
 * Adds the repository containing `path`. The stored path is the repository root, so
 * adding a subdirectory and adding the root resolve to the same project.
 */
export async function addProject(repos: Repos, path: string): Promise<Project> {
  const requested = resolve(path);
  if (!existsSync(requested)) throw badRequest('project path does not exist');
  const root = await repoRoot(requested);
  if (root === null) throw badRequest('project path is not a git repository');
  if (repos.projects.findByPath(root) !== undefined) {
    throw conflict('project is already added');
  }
  return repos.projects.add({
    id: newId('prj'),
    name: basename(root),
    path: root,
    defaultBranch: await detectDefaultBranch(root),
    createdAt: new Date().toISOString(),
  });
}

export function listProjects(repos: Repos): Project[] {
  return repos.projects.list();
}

/**
 * Removes a project row (threads cascade). With `deleteWorktrees` every thread
 * worktree is removed from git and disk first, including the project's worktree
 * directory under the configured root.
 */
export async function removeProject(
  repos: Repos,
  id: string,
  deleteWorktrees: boolean,
): Promise<void> {
  const project = repos.projects.get(id);
  if (project === undefined) throw notFound('project not found');
  if (deleteWorktrees) {
    for (const thread of repos.threads.listByProject(id)) {
      if (thread.worktreePath !== null) {
        await removeWorktree(project.path, thread.worktreePath);
      }
    }
    const root = repos.settings.get().worktreeRoot ?? worktreesRoot();
    rmSync(join(root, id), { recursive: true, force: true });
  }
  repos.projects.remove(id);
}

/** Re-validates the project path and refreshes its name, default branch and opened time. */
export async function refreshProject(repos: Repos, id: string): Promise<Project> {
  const project = repos.projects.get(id);
  if (project === undefined) throw notFound('project not found');
  const root = await repoRoot(project.path);
  if (root === null) throw badRequest('project path is not a git repository');
  repos.projects.updateMeta(
    id,
    { name: basename(root), defaultBranch: await detectDefaultBranch(root) },
    new Date().toISOString(),
  );
  const refreshed = repos.projects.get(id);
  if (refreshed === undefined) throw notFound('project not found');
  return refreshed;
}
