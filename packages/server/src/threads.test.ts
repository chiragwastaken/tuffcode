import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isInside } from '@tuffcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addProject } from './projects.js';
import {
  addTestProvider,
  createTestContext,
  git,
  initRepo,
  type TestContext,
} from './test-support.js';
import { createThread, deleteThread, updateThread } from './threads.js';

describe('threads service', () => {
  let ctx: TestContext;
  let repo: string;

  beforeEach(async () => {
    ctx = createTestContext();
    repo = initRepo(join(ctx.env.root, 'thread-repo'));
    addTestProvider(ctx.repos);
  });

  afterEach(() => {
    ctx.dispose();
  });

  async function createTestThread(baseBranch?: string) {
    const project = await addProject(ctx.repos, repo);
    return createThread(ctx.repos, {
      projectId: project.id,
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      ...(baseBranch === undefined ? {} : { baseBranch }),
    });
  }

  it('provisions a worktree on a new tuffcode branch', async () => {
    const thread = await createTestThread();
    expect(thread.branch).toBe(`tuffcode/${thread.id}`);
    expect(thread.baseBranch).toBe('main');
    expect(thread.status).toBe('idle');
    expect(thread.worktreePath).not.toBeNull();
    const worktreePath = thread.worktreePath ?? '';
    expect(existsSync(worktreePath)).toBe(true);
    expect(isInside(repo, worktreePath)).toBe(false);
    expect(git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(thread.branch);

    const listed = git(repo, ['worktree', 'list', '--porcelain']).replace(/\\/g, '/').toLowerCase();
    expect(listed).toContain(worktreePath.replace(/\\/g, '/').toLowerCase());
  });

  it('rejects a missing base branch', async () => {
    await expect(createTestThread('does-not-exist')).rejects.toThrow('base branch not found');
  });

  it('rejects a worktree root inside the project', async () => {
    ctx.repos.settings.patch({ worktreeRoot: join(repo, 'worktrees') });
    await expect(createTestThread()).rejects.toThrow('worktree root must be outside the project');
  });

  it('updates thread metadata', async () => {
    const thread = await createTestThread();
    const updated = updateThread(ctx.repos, {
      id: thread.id,
      title: 'Renamed',
      modelId: 'model-y',
      permissionMode: 'full-auto',
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.modelId).toBe('model-y');
    expect(updated.permissionMode).toBe('full-auto');
    expect(updated.branch).toBe(thread.branch);
  });

  it('removes the worktree when deleting a thread', async () => {
    const thread = await createTestThread();
    const worktreePath = thread.worktreePath ?? '';
    await deleteThread(ctx.repos, thread.id, true);
    expect(existsSync(worktreePath)).toBe(false);
    expect(ctx.repos.threads.get(thread.id)).toBeUndefined();
    const listed = git(repo, ['worktree', 'list', '--porcelain']).replace(/\\/g, '/').toLowerCase();
    expect(listed).not.toContain(worktreePath.replace(/\\/g, '/').toLowerCase());
  });

  it('keeps the worktree when deletion does not ask for removal', async () => {
    const thread = await createTestThread();
    const worktreePath = thread.worktreePath ?? '';
    await deleteThread(ctx.repos, thread.id, false);
    expect(existsSync(worktreePath)).toBe(true);
  });
});
