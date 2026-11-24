import type { ExecutionMode, PermissionMode, Thread } from '@tuffcode/contracts';
import { newId, worktreesRoot } from '@tuffcode/shared';
import type { Repos } from './db/repos/index.js';
import { badRequest, notFound, RpcError } from './errors.js';
import { provisionWorktree, removeWorktree } from './git/worktree.js';

export interface CreateThreadRequest {
  projectId: string;
  title?: string;
  providerId: string;
  modelId: string;
  executionMode: ExecutionMode;
  permissionMode: PermissionMode;
  baseBranch?: string;
}

export interface UpdateThreadRequest {
  id: string;
  title?: string;
  modelId?: string;
  executionMode?: ExecutionMode;
  permissionMode?: PermissionMode;
}

/**
 * Creates the thread row and its worktree on a fresh `tuffcode/<threadId>` branch.
 * The worktree is provisioned first; if the insert fails the worktree is removed so
 * the repository is never left with an orphan checkout.
 */
export async function createThread(repos: Repos, request: CreateThreadRequest): Promise<Thread> {
  const project = repos.projects.get(request.projectId);
  if (project === undefined) throw notFound('project not found');
  const provider = repos.providers.get(request.providerId);
  if (provider === undefined) throw notFound('provider not found');
  if (!provider.enabled) {
    throw new RpcError('provider-unavailable', 'provider is disabled');
  }
  if (request.modelId.trim().length === 0) throw badRequest('model id is required');

  const id = newId('thr');
  const baseBranch = request.baseBranch ?? project.defaultBranch;
  const root = repos.settings.get().worktreeRoot ?? worktreesRoot();
  const worktree = await provisionWorktree({
    repoPath: project.path,
    baseBranch,
    projectId: project.id,
    threadId: id,
    worktreesRoot: root,
  });
  const now = new Date().toISOString();
  try {
    return repos.threads.create({
      id,
      projectId: project.id,
      parentThreadId: null,
      title: request.title?.trim() || `Thread ${id.slice(4, 12)}`,
      providerId: provider.id,
      modelId: request.modelId,
      executionMode: request.executionMode,
      permissionMode: request.permissionMode,
      status: 'idle',
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    await removeWorktree(project.path, worktree.path).catch(() => undefined);
    throw error;
  }
}

export function getThread(repos: Repos, id: string): Thread {
  const thread = repos.threads.get(id);
  if (thread === undefined) throw notFound('thread not found');
  return thread;
}

export function listThreads(repos: Repos, projectId?: string): Thread[] {
  return repos.threads.list(projectId);
}

export function updateThread(repos: Repos, request: UpdateThreadRequest): Thread {
  const existing = getThread(repos, request.id);
  const title = request.title === undefined ? undefined : request.title.trim();
  if (title !== undefined && title.length === 0) throw badRequest('title is required');
  const updated = repos.threads.update(existing.id, {
    title,
    modelId: request.modelId,
    executionMode: request.executionMode,
    permissionMode: request.permissionMode,
    updatedAt: new Date().toISOString(),
  });
  if (updated === undefined) throw notFound('thread not found');
  return updated;
}

/**
 * Deletes the thread row. With `removeWorktree` the checkout is removed from git and
 * disk first; without it the directory is left in place for manual recovery.
 */
export async function deleteThread(
  repos: Repos,
  id: string,
  removeWorktreeFlag: boolean,
): Promise<void> {
  const thread = getThread(repos, id);
  if (removeWorktreeFlag && thread.worktreePath !== null) {
    const project = repos.projects.get(thread.projectId);
    if (project !== undefined) {
      await removeWorktree(project.path, thread.worktreePath);
    }
  }
  repos.threads.remove(id);
}
