import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectThread,
  createTestContext,
  git,
  initRepo,
  type ProjectThread,
  type TestContext,
} from '../test-support.js';
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

  it('creates a ref, then reverts tracked edits and cleans untracked files', async () => {
    writeFileSync(readme, '# demo\ncheckpointed\n');
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'before edit');
    expect(checkpoint.threadId).toBe(setup.thread.id);
    expect(checkpoint.label).toBe('before edit');
    expect(checkpoint.ref).toBe(`refs/tuffcode/${setup.thread.id}/${checkpoint.id}`);
    expect(checkpoint.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(listCheckpoints(ctx.repos, setup.thread.id)).toHaveLength(1);

    writeFileSync(readme, '# demo\nchanged\n');
    const scratch = join(worktree, 'scratch.txt');
    writeFileSync(scratch, 'temporary\n');

    await expect(
      revertCheckpoint(ctx.repos, setup.thread.id, checkpoint.id, false),
    ).rejects.toThrow('revert requires confirmation');
    expect(readFileSync(readme, 'utf8')).toBe('# demo\nchanged\n');
    expect(existsSync(scratch)).toBe(true);

    await revertCheckpoint(ctx.repos, setup.thread.id, checkpoint.id, true);
    expect(readFileSync(readme, 'utf8')).toBe('# demo\ncheckpointed\n');
    expect(existsSync(scratch)).toBe(false);
  });

  it('snapshots HEAD when the worktree is clean', async () => {
    const head = git(worktree, ['rev-parse', 'HEAD']);
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'clean tree');
    expect(checkpoint.commitSha).toBe(head);
  });

  it('rejects a checkpoint from another thread', async () => {
    const checkpoint = await createCheckpoint(ctx.repos, setup.thread.id, 'mine');
    const other = await createProjectThread(ctx.repos, initRepo(join(ctx.env.root, 'other-repo')));
    await expect(revertCheckpoint(ctx.repos, other.thread.id, checkpoint.id, true)).rejects.toThrow(
      'checkpoint not found',
    );
  });
});
