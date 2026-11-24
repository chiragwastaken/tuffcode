import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addProject } from '../projects.js';
import { createTestContext, initRepo, type TestContext } from '../test-support.js';
import { deleteChildThread, provisionChildThread } from './threads.js';

let ctx: TestContext | undefined;

afterEach(() => {
  ctx?.dispose();
  ctx = undefined;
});

describe('provisionChildThread', () => {
  it('creates a worktree and parent link, then disposes both', async () => {
    ctx = createTestContext();
    const repoPath = initRepo(join(ctx.env.root, 'repo'));
    const project = await addProject(ctx.repos, repoPath);
    ctx.repos.providers.upsert({ id: 'prv_test', kind: 'claude', label: 'Test', config: {} });
    const now = new Date().toISOString();
    const goal = ctx.repos.threads.create({
      id: 'thr_goal',
      projectId: project.id,
      parentThreadId: null,
      title: 'Goal',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'council',
      permissionMode: 'full-auto',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: project.defaultBranch,
      createdAt: now,
      updatedAt: now,
    });

    const child = await provisionChildThread(ctx.repos, {
      projectId: project.id,
      parentThreadId: goal.id,
      title: 'Council: Add widget',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'full-auto',
      baseBranch: project.defaultBranch,
    });

    expect(child.parentThreadId).toBe(goal.id);
    expect(child.title).toBe('Council: Add widget');
    expect(child.branch).toBe(`tuffcode/${child.id}`);
    expect(child.worktreePath).not.toBeNull();
    expect(existsSync(child.worktreePath ?? '')).toBe(true);

    await deleteChildThread(ctx.repos, child.id);
    expect(ctx.repos.threads.get(child.id)).toBeUndefined();
    expect(existsSync(child.worktreePath ?? '')).toBe(false);
  });

  it('treats a missing child thread as already disposed', async () => {
    ctx = createTestContext();
    await expect(deleteChildThread(ctx.repos, 'thr_missing')).resolves.toBeUndefined();
  });

  it('rejects a disabled provider without touching git', async () => {
    ctx = createTestContext();
    const repoPath = initRepo(join(ctx.env.root, 'repo'));
    const project = await addProject(ctx.repos, repoPath);
    ctx.repos.providers.upsert({
      id: 'prv_off',
      kind: 'claude',
      label: 'Off',
      config: {},
      enabled: false,
    });
    await expect(
      provisionChildThread(ctx.repos, {
        projectId: project.id,
        parentThreadId: 'thr_goal',
        title: 'Council: Nope',
        providerId: 'prv_off',
        modelId: 'model-x',
        executionMode: 'work',
        permissionMode: 'full-auto',
        baseBranch: project.defaultBranch,
      }),
    ).rejects.toThrow(/provider is disabled/i);
  });
});
