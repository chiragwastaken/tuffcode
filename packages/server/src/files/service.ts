import { open, stat } from 'node:fs/promises';
import type { RpcParams, RpcResult } from '@tuffcode/contracts';
import { resolveWithin } from '@tuffcode/shared';
import type { Repos } from '../db/repos/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { runGit } from '../git/runGit.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';

/**
 * The Files explorer: one git listing per open (tracked plus untracked files that are
 * not ignored, so build output and node_modules never flood the tree) and a bounded
 * read-only preview. Every path is resolved inside the thread worktree.
 */
export const FILE_TREE_LIMIT = 20_000;
export const FILE_READ_LIMIT = 256 * 1024;

function worktreeOf(repos: Repos, threadId: string): string {
  const thread = repos.threads.get(threadId);
  if (thread === undefined) throw notFound('thread not found');
  if (thread.worktreePath === null) throw conflict('thread has no worktree');
  return thread.worktreePath;
}

export async function listFiles(repos: Repos, threadId: string): Promise<RpcResult<'files.tree'>> {
  const cwd = worktreeOf(repos, threadId);
  const output = await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd, {
    timeoutMs: 20_000,
    maxBufferBytes: 16 * 1024 * 1024,
  });
  const unique = [...new Set(output.split('\0').filter((path) => path.length > 0))].toSorted((a, b) =>
    a.localeCompare(b),
  );
  return { paths: unique.slice(0, FILE_TREE_LIMIT), truncated: unique.length > FILE_TREE_LIMIT };
}

export async function readFilePreview(
  repos: Repos,
  params: RpcParams<'files.read'>,
): Promise<RpcResult<'files.read'>> {
  const cwd = worktreeOf(repos, params.threadId);
  let target: string;
  try {
    target = resolveWithin(cwd, params.path);
  } catch {
    throw badRequest('path escapes the worktree');
  }
  const info = await stat(target).catch(() => null);
  if (info === null || !info.isFile()) throw notFound('file not found');
  const handle = await open(target, 'r');
  try {
    const length = Math.min(info.size, FILE_READ_LIMIT);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    if (buffer.includes(0)) return { text: '', truncated: false, binary: true };
    return { text: buffer.toString('utf8'), truncated: info.size > FILE_READ_LIMIT, binary: false };
  } finally {
    await handle.close();
  }
}

export function createFileHandlers(deps: { repos: Repos }): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();
  handlers.set('files.tree', (params) =>
    listFiles(deps.repos, (params as RpcParams<'files.tree'>).threadId),
  );
  handlers.set('files.read', (params) => readFilePreview(deps.repos, params as RpcParams<'files.read'>));
  return handlers;
}
