import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addProject } from '../projects.js';
import {
  createProjectThread,
  createTestContext,
  git,
  initRepo,
  type ProjectThread,
  type TestContext,
} from '../test-support.js';
import { createThread } from '../threads.js';
import { createCheckpoint, listCheckpoints, revertCheckpoint } from './checkpoints.js';

describe('git checkpoints', () => {
  let ctx: TestContext;
  let setup: ProjectThread;
  let worktree: string;
  let readme: string;

  beforeEach(async () => {
    ctx = createTestContext();
    setup = await createProjectThread(ctx.repos, initRepo(join(ctx.env.root, 'checkpoint-repo')));
    worktree = setup.thread.worktreePath ?? '';
    readme = join(worktree, 'README.md');
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('snapshots untracked files without touching HEAD, the branch, or the index', async () => {
    const head = git(worktree, ['rev-parse', 'HEAD']);
    const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
    writeFileSync(readme, '# demo\ncheckpointed\n');
    writeFileSync(join(worktree, 'keep.txt'), 'keep me\n');

    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'before edit');

    expect(checkpoint.threadId).toBe(setup.thread.id);
    expect(checkpoint.label).toBe('before edit');
    expect(checkpoint.ref).toBe(`refs/tuffcode/${setup.thread.id}/${checkpoint.id}`);
    expect(checkpoint.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(checkpoint.commitSha).not.toBe(head);
    expect(listCheckpoints(ctx.repos, setup.thread.id)).toHaveLength(1);
    // The snapshot holds the untracked file, not just the tracked edits.
    expect(git(worktree, ['ls-tree', '-r', '--name-only', checkpoint.commitSha]).split('\n')).toEqual(
      ['README.md', 'keep.txt'],
    );
    // HEAD and the branch never move, and the real index still knows nothing about keep.txt.
    expect(git(worktree, ['rev-parse', 'HEAD'])).toBe(head);
    expect(git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(branch);
    expect(git(worktree, ['ls-files', '--cached', '--name-only']).split('\n')).toEqual([
      'README.md',
    ]);
  });

  it('reverts to the snapshot, keeps captured files, and removes files created later', async () => {
    const head = git(worktree, ['rev-parse', 'HEAD']);
    const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
    writeFileSync(readme, '# demo\ncheckpointed\n');
    writeFileSync(join(worktree, 'keep.txt'), 'keep me\n');
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'before edit');

    writeFileSync(readme, '# demo\nchanged\n');
    writeFileSync(join(worktree, 'keep.txt'), 'overwritten\n');
    writeFileSync(join(worktree, 'scratch.txt'), 'temporary\n');
    mkdirSync(join(worktree, 'scratch-dir', 'deep'), { recursive: true });
    writeFileSync(join(worktree, 'scratch-dir', 'deep', 'note.txt'), 'temporary\n');

    await revertCheckpoint(ctx.repos, setup.thread.id, checkpoint.id, true);

    expect(readFileSync(readme, 'utf8')).toBe('# demo\ncheckpointed\n');
    expect(readFileSync(join(worktree, 'keep.txt'), 'utf8')).toBe('keep me\n');
    expect(existsSync(join(worktree, 'scratch.txt'))).toBe(false);
    expect(existsSync(join(worktree, 'scratch-dir'))).toBe(false);
    // The restore rewrote index and worktree but never committed or moved the branch.
    expect(git(worktree, ['rev-parse', 'HEAD'])).toBe(head);
    expect(git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(branch);
    expect(git(worktree, ['diff', '--cached', '--name-only', 'HEAD']).split('\n')).toEqual([
      'README.md',
      'keep.txt',
    ]);
  });

  it('requires confirmation and leaves the worktree alone when it is missing', async () => {
    writeFileSync(readme, '# demo\ncheckpointed\n');
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'before edit');
    writeFileSync(readme, '# demo\nchanged\n');
    const scratch = join(worktree, 'scratch.txt');
    writeFileSync(scratch, 'temporary\n');

    await expect(
      revertCheckpoint(ctx.repos, setup.thread.id, checkpoint.id, false),
    ).rejects.toThrow('revert requires confirmation');

    expect(readFileSync(readme, 'utf8')).toBe('# demo\nchanged\n');
    expect(existsSync(scratch)).toBe(true);
    // The gate runs before any side effect, so no recovery checkpoint was recorded.
    expect(listCheckpoints(ctx.repos, setup.thread.id)).toHaveLength(1);
  });

  it('snapshots HEAD when the worktree is clean', async () => {
    const head = git(worktree, ['rev-parse', 'HEAD']);
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'clean tree');
    expect(checkpoint.commitSha).toBe(head);
    expect(git(worktree, ['rev-parse', 'HEAD'])).toBe(head);
  });

  it('records a recovery checkpoint before discarding a dirty worktree', async () => {
    writeFileSync(readme, '# demo\ncheckpointed\n');
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'before edit');
    writeFileSync(readme, '# demo\nabout to be lost\n');
    writeFileSync(join(worktree, 'lost.txt'), 'lost\n');

    await revertCheckpoint(ctx.repos, setup.thread.id, checkpoint.id, true);

    const recovery = listCheckpoints(ctx.repos, setup.thread.id).find(
      (entry) => entry.label === 'before revert: before edit',
    );
    expect(recovery).toBeDefined();
    expect(git(worktree, ['show', `${recovery?.commitSha}:README.md`])).toBe(
      '# demo\nabout to be lost',
    );
    expect(git(worktree, ['show', `${recovery?.commitSha}:lost.txt`])).toBe('lost');
    expect(existsSync(join(worktree, 'lost.txt'))).toBe(false);
  });

  it('skips the recovery checkpoint when the worktree is already clean', async () => {
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'clean point');
    await revertCheckpoint(ctx.repos, setup.thread.id, checkpoint.id, true);
    expect(listCheckpoints(ctx.repos, setup.thread.id)).toHaveLength(1);
  });

  it('restores a legacy stash checkpoint without deleting files it never captured', async () => {
    const head = git(worktree, ['rev-parse', 'HEAD']);
    writeFileSync(readme, '# demo\nlegacy\n');
    const stashSha = git(worktree, ['stash', 'create']);
    expect(stashSha).toMatch(/^[0-9a-f]{40}$/);
    const ref = `refs/tuffcode/${setup.thread.id}/ckp_legacy`;
    git(worktree, ['update-ref', ref, stashSha]);
    const legacy = ctx.repos.checkpoints.create({
      id: 'ckp_legacy',
      threadId: setup.thread.id,
      ref,
      label: 'legacy',
      commitSha: stashSha,
      createdAt: new Date().toISOString(),
    });

    writeFileSync(readme, '# demo\nlater\n');
    const uncaptured = join(worktree, 'uncaptured.txt');
    writeFileSync(uncaptured, 'keep\n');

    await revertCheckpoint(ctx.repos, setup.thread.id, legacy.id, true);

    expect(readFileSync(readme, 'utf8')).toBe('# demo\nlegacy\n');
    // The stash commit never held untracked files, so the revert must not clean them.
    expect(existsSync(uncaptured)).toBe(true);
    expect(git(worktree, ['rev-parse', 'HEAD'])).toBe(head);
  });

  it('rejects a checkpoint from another thread', async () => {
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'mine');
    const other = await createProjectThread(ctx.repos, initRepo(join(ctx.env.root, 'other-repo')));
    await expect(revertCheckpoint(ctx.repos, other.thread.id, checkpoint.id, true)).rejects.toThrow(
      'checkpoint not found',
    );
  });

  it('refuses to revert a folder-backed thread', async () => {
    const project = await addProject(ctx.repos, initRepo(join(ctx.env.root, 'folder-repo')));
    const thread = await createThread(ctx.repos, {
      projectId: project.id,
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      workspace: 'folder',
    });
    expect(thread.worktreePath).toBe(project.path);
    const checkpoint = await createCheckpoint(ctx.repos, thread.id, 'folder snapshot');
    const projectReadme = join(project.path, 'README.md');
    const head = git(project.path, ['rev-parse', 'HEAD']);
    writeFileSync(projectReadme, '# demo\nchanged in the project\n');

    await expect(revertCheckpoint(ctx.repos, thread.id, checkpoint.id, true)).rejects.toThrow(
      'folder-backed',
    );

    expect(readFileSync(projectReadme, 'utf8')).toBe('# demo\nchanged in the project\n');
    expect(git(project.path, ['rev-parse', 'HEAD'])).toBe(head);
    expect(listCheckpoints(ctx.repos, thread.id)).toHaveLength(1);
  });
});
