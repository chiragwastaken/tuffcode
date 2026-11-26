import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, initRepo, type TestContext } from '../test-support.js';
import { provisionWorktree, removeWorktree } from './worktree.js';

describe('worktree removal safety', () => {
  let ctx: TestContext;
  let repo: string;
  let root: string;

  beforeEach(() => {
    ctx = createTestContext();
    repo = initRepo(join(ctx.env.root, 'guard-repo'));
    root = join(ctx.env.root, 'worktrees');
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    ctx.dispose();
  });

  async function provision(): Promise<string> {
    const worktree = await provisionWorktree({
      repoPath: repo,
      baseBranch: 'main',
      projectId: 'prj',
      threadId: 'thr',
      worktreesRoot: root,
    });
    return worktree.path;
  }

  it('removes a checkout that sits inside the worktrees root', async () => {
    const path = await provision();
    expect(existsSync(path)).toBe(true);
    await removeWorktree(repo, path, { worktreesRoot: root });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
  });

  it('refuses to remove the project checkout', async () => {
    await expect(removeWorktree(repo, repo, { worktreesRoot: root })).rejects.toThrow(
      'refusing to remove the project checkout',
    );
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
    expect(existsSync(join(repo, '.git'))).toBe(true);
  });

  it('refuses a path outside the worktrees root without deleting it', async () => {
    const outside = join(ctx.env.root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'keep me\n');

    await expect(removeWorktree(repo, outside, { worktreesRoot: root })).rejects.toThrow(
      'outside the worktrees root',
    );
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
  });

  it('refuses the worktrees root itself', async () => {
    await expect(removeWorktree(repo, root, { worktreesRoot: root })).rejects.toThrow(
      'outside the worktrees root',
    );
    expect(existsSync(root)).toBe(true);
  });
});
