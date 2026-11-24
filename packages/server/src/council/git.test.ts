import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectThread,
  createTestContext,
  git,
  initRepo,
  type TestContext,
} from '../test-support.js';
import { changesForThread } from './git.js';

let ctx: TestContext | undefined;

afterEach(() => {
  ctx?.dispose();
  ctx = undefined;
});

describe('changesForThread', () => {
  it('reports no changes on a fresh worktree', async () => {
    ctx = createTestContext();
    const repoPath = initRepo(join(ctx.env.root, 'repo'));
    const { thread } = await createProjectThread(ctx.repos, repoPath);
    await expect(changesForThread(ctx.repos, thread.id)).resolves.toEqual({
      changed: false,
      files: [],
      patch: '',
    });
  });

  it('reports a committed change with its files and patch', async () => {
    ctx = createTestContext();
    const repoPath = initRepo(join(ctx.env.root, 'repo'));
    const { thread } = await createProjectThread(ctx.repos, repoPath);
    const worktree = thread.worktreePath ?? '';
    writeFileSync(join(worktree, 'feature.ts'), 'export const widget = 1;\n');
    git(worktree, ['add', 'feature.ts']);
    git(worktree, ['commit', '-m', 'feat: add widget']);

    const changes = await changesForThread(ctx.repos, thread.id);
    expect(changes.changed).toBe(true);
    expect(changes.files).toContain('feature.ts');
    expect(changes.patch).toContain('export const widget = 1;');
  });

  it('detects uncommitted work', async () => {
    ctx = createTestContext();
    const repoPath = initRepo(join(ctx.env.root, 'repo'));
    const { thread } = await createProjectThread(ctx.repos, repoPath);
    writeFileSync(join(thread.worktreePath ?? '', 'dirty.ts'), 'export const dirty = true;\n');
    const changes = await changesForThread(ctx.repos, thread.id);
    expect(changes.changed).toBe(true);
  });
});
