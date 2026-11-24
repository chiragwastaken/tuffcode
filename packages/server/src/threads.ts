import type { ExecutionMode, PermissionMode, Thread } from '@tuffcode/contracts';
import { newId, worktreesRoot } from '@tuffcode/shared';
import type { Repos } from './db/repos/index.js';
import { badRequest, conflict, notFound, RpcError } from './errors.js';
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

/** Messages kept verbatim when a thread is compacted; the rest fold into a digest. */
export const COMPACT_KEEP_MESSAGES = 8;

/** The digest is stored as one system row, so it stays bounded. */
const COMPACT_DIGEST_LIMIT = 2000;

export interface ClearThreadResult {
  messages: number;
  events: number;
}

/**
 * Empties a thread's transcript and event log. The caller drops the cached adapter
 * session first, so the model starts without the earlier conversation either.
 */
export function clearThread(repos: Repos, threadId: string): ClearThreadResult {
  const thread = getThread(repos, threadId);
  if (thread.status === 'running') throw conflict('stop the running turn before clearing');
  return repos.transaction(() => ({
    messages: repos.messages.removeByThread(thread.id),
    events: repos.events.removeByThread(thread.id),
  }));
}

export interface CompactThreadResult {
  removed: number;
  kept: number;
}

function digestLine(role: string, content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return `- ${role}: ${text.length <= 100 ? text : `${text.slice(0, 97)}...`}`;
}

/**
 * Folds all but the newest `COMPACT_KEEP_MESSAGES` rows into one system digest.
 * The transcript the UI renders keeps only the recent rows; the digest preserves a
 * short record of what was removed.
 */
export function compactThread(
  repos: Repos,
  threadId: string,
  instructions = '',
): CompactThreadResult {
  const thread = getThread(repos, threadId);
  if (thread.status === 'running') throw conflict('stop the running turn before compacting');
  const messages = repos.messages.list(thread.id, 1000);
  if (messages.length <= COMPACT_KEEP_MESSAGES) {
    return { removed: 0, kept: messages.length };
  }
  const removed = messages.slice(0, messages.length - COMPACT_KEEP_MESSAGES);
  const note = instructions.trim();
  let digest = `Compacted ${removed.length} earlier messages.`;
  if (note.length > 0) digest += ` Instructions: ${note}`;
  const lines: string[] = [];
  for (const message of removed) {
    const line = digestLine(message.role, message.content);
    if (digest.length + line.length + 1 > COMPACT_DIGEST_LIMIT) break;
    lines.push(line);
  }
  if (lines.length > 0) digest += `\n${lines.join('\n')}`;
  const createdAt = new Date().toISOString();
  repos.transaction(() => {
    repos.messages.removeMany(removed.map((message) => message.id));
    repos.messages.add({
      id: newId('msg'),
      threadId: thread.id,
      role: 'system',
      content: digest,
      createdAt,
    });
  });
  return { removed: removed.length, kept: messages.length - removed.length };
}
