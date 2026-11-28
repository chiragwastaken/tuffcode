import { mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { Checkpoint } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import type { Repos } from '../db/repos/index.js';
import { badRequest, notFound, RpcError } from '../errors.js';
import { requireWorktree } from './context.js';
import { runGit, scrubbedEnv } from './runGit.js';
import { samePath } from './worktree.js';

/**
 * Subject of every snapshot commit. `commit-tree` is the only way to write one, so a
 * revert can tell a full tree snapshot from a legacy `git stash create` commit, whose
 * tree holds tracked files only.
 */
const SNAPSHOT_SUBJECT = 'tuffcode checkpoint';

/** Pathspecs per `git clean` call, keeping argv well under the Windows limit. */
const CLEAN_BATCH = 50;

interface Snapshot {
  /** Commit that holds the snapshot tree; HEAD itself when the worktree matches it. */
  commitSha: string;
  /** True when the tree differs from HEAD, so the snapshot holds working-tree content. */
  dirty: boolean;
}

/**
 * Writes the worktree, untracked non-ignored files included, as a tree and wraps it in a
 * commit whose parent is HEAD. The real index, HEAD, and the branch are never touched:
 * `git add -A` runs against a throwaway `GIT_INDEX_FILE` outside the worktree, and
 * `commit-tree` creates a dangling commit that only the checkpoint ref keeps reachable.
 */
async function writeSnapshot(worktreePath: string): Promise<Snapshot> {
  const headSha = (await runGit(['rev-parse', 'HEAD'], worktreePath)).trim();
  const headTree = (await runGit(['rev-parse', 'HEAD^{tree}'], worktreePath)).trim();
  const indexDir = mkdtempSync(join(tmpdir(), 'tuffcode-snapshot-'));
  try {
    const env: NodeJS.ProcessEnv = { ...scrubbedEnv(), GIT_INDEX_FILE: join(indexDir, 'index') };
    await runGit(['add', '-A'], worktreePath, { env });
    const tree = (await runGit(['write-tree'], worktreePath, { env })).trim();
    if (tree === headTree) return { commitSha: headSha, dirty: false };
    // The synthetic identity keeps the call working in repositories where the user has
    // no committer identity configured; these commits are never shown as user work.
    const commitSha = (
      await runGit(
        [
          '-c',
          'user.name=Tuffcode',
          '-c',
          'user.email=checkpoint@tuffcode.local',
          'commit-tree',
          tree,
          '-p',
          headSha,
          '-m',
          SNAPSHOT_SUBJECT,
        ],
        worktreePath,
      )
    ).trim();
    return { commitSha, dirty: true };
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
}

async function recordCheckpoint(
  repos: Repos,
  worktreePath: string,
  threadId: string,
  label: string,
  snapshot: Snapshot,
): Promise<Checkpoint> {
  const id = newId('ckp');
  const ref = `refs/tuffcode/${threadId}/${id}`;
  // The ref is written first so the row never points at a commit gc could collect.
  await runGit(['update-ref', ref, snapshot.commitSha], worktreePath);
  return repos.checkpoints.create({
    id,
    threadId,
    ref,
    label,
    commitSha: snapshot.commitSha,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Snapshots the worktree and keeps the snapshot commit reachable through
 * `refs/tuffcode/<threadId>/<id>`. A clean worktree stores HEAD, because HEAD's tree is
 * already the snapshot and a second commit would say nothing new.
 */
export async function createCheckpoint(
  repos: Repos,
  threadId: string,
  label: string,
): Promise<Checkpoint> {
  const trimmed = label.trim();
  if (trimmed.length === 0) throw badRequest('checkpoint label is required');
  const { worktreePath } = requireWorktree(repos, threadId);
  const snapshot = await writeSnapshot(worktreePath);
  return recordCheckpoint(repos, worktreePath, threadId, trimmed, snapshot);
}

export function listCheckpoints(repos: Repos, threadId: string): Checkpoint[] {
  if (repos.threads.get(threadId) === undefined) throw notFound('thread not found');
  return repos.checkpoints.list(threadId);
}

/** Windows compares paths case-insensitively, so entry names must too. */
function entryKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/** Removes directories the clean left empty, stopping at the first non-empty one. */
function pruneEmptyParents(worktreePath: string, filePath: string): void {
  let dir = dirname(join(worktreePath, filePath));
  for (;;) {
    const rel = relative(worktreePath, dir);
    if (rel.length === 0 || rel.startsWith('..')) return;
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

/**
 * Deletes the files the snapshot does not hold: untracked, non-ignored paths left behind
 * by work done after the checkpoint. The delete set is computed from git's own untracked
 * list and filtered against the snapshot tree, so a file the checkpoint captured can
 * never be removed, and ignored files (`node_modules`, build output) are never touched.
 */
async function removeNewFiles(worktreePath: string, snapshotSha: string): Promise<void> {
  const snapshotPaths = new Set(
    (await runGit(['ls-tree', '-r', '-z', '--name-only', snapshotSha], worktreePath))
      .split('\0')
      .filter((path) => path.length > 0)
      .map(entryKey),
  );
  const untracked = (
    await runGit(['ls-files', '--others', '--exclude-standard', '-z'], worktreePath)
  )
    .split('\0')
    .filter((path) => path.length > 0);
  const removable = untracked.filter((path) => !snapshotPaths.has(entryKey(path)));
  for (let start = 0; start < removable.length; start += CLEAN_BATCH) {
    await runGit(
      ['clean', '-f', '-d', '--', ...removable.slice(start, start + CLEAN_BATCH)],
      worktreePath,
    );
  }
  for (const path of removable) pruneEmptyParents(worktreePath, path);
}

/** True when the commit was written by `writeSnapshot` and therefore holds untracked files. */
async function isFullSnapshot(worktreePath: string, commitSha: string): Promise<boolean> {
  const body = await runGit(['cat-file', '-p', commitSha], worktreePath);
  return body.includes(`\n\n${SNAPSHOT_SUBJECT}`);
}

/**
 * Restores the worktree to a checkpoint. Destructive by design, so it refuses unless the
 * caller passes `confirm`. `git read-tree --reset -u` rewrites index and worktree from
 * the snapshot tree while HEAD and the branch stay put, so a revert never commits and
 * never detaches the checkout. A dirty worktree is snapshotted first, which makes the
 * clean that follows recoverable.
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
  const { thread, worktreePath } = requireWorktree(repos, threadId);
  // A folder-backed thread runs in the project checkout itself. Restoring it would
  // rewrite files the thread does not own, so the revert is refused instead.
  const project = repos.projects.get(thread.projectId);
  if (project !== undefined && samePath(worktreePath, project.path)) {
    throw badRequest('revert is not available for a folder-backed thread');
  }
  const checkpoint = repos.checkpoints.get(checkpointId);
  if (checkpoint === undefined || checkpoint.threadId !== threadId) {
    throw notFound('checkpoint not found');
  }
  const current = await writeSnapshot(worktreePath);
  if (current.dirty) {
    await recordCheckpoint(
      repos,
      worktreePath,
      threadId,
      `before revert: ${checkpoint.label}`,
      current,
    );
  }
  // Legacy checkpoints were built by `git stash create`, which never captured untracked
  // files. Cleaning against them would delete files no snapshot holds, so only full
  // snapshots get the clean. The check runs before the restore so a bad commit fails
  // early instead of halfway through.
  const full = await isFullSnapshot(worktreePath, checkpoint.commitSha);
  await runGit(['read-tree', '--reset', '-u', checkpoint.commitSha], worktreePath);
  if (full) {
    await removeNewFiles(worktreePath, checkpoint.commitSha);
  }
}
