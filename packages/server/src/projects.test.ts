import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addProject, listProjects, refreshProject, removeProject } from './projects.js';
import { addTestProvider, createTestContext, initRepo, type TestContext } from './test-support.js';
import { createThread } from './threads.js';

describe('projects service', () => {
  let ctx: TestContext;
  let repo: string;

  beforeEach(() => {
    ctx = createTestContext();
    repo = initRepo(join(ctx.env.root, 'demo-repo'));
  });

  afterEach(() => {
    ctx.dispose();
  });

  it('adds and lists a git repository', async () => {
    const project = await addProject(ctx.repos, repo);
    expect(project.name).toBe('demo-repo');
    expect(project.defaultBranch).toBe('main');
    expect(project.path.toLowerCase()).toBe(
      realpathSync.native(repo).replace(/\//g, '\\').toLowerCase(),
    );
    expect(project.lastOpenedAt).not.toBeNull();
    expect(listProjects(ctx.repos).map((row) => row.id)).toEqual([project.id]);
  });

  it('rejects duplicates and non-repositories', async () => {
    await addProject(ctx.repos, repo);
    await expect(addProject(ctx.repos, repo)).rejects.toThrow('already added');

    const plain = join(ctx.env.root, 'plain');
    mkdirSync(plain, { recursive: true });
    await expect(addProject(ctx.repos, plain)).rejects.toThrow('not a git repository');
    await expect(addProject(ctx.repos, join(ctx.env.root, 'missing'))).rejects.toThrow(
      'does not exist',
    );
  });

  it('refreshes metadata without changing identity', async () => {
    const project = await addProject(ctx.repos, repo);
    const refreshed = await refreshProject(ctx.repos, project.id);
    expect(refreshed.id).toBe(project.id);
    expect(refreshed.name).toBe('demo-repo');
    expect(refreshed.defaultBranch).toBe('main');
    expect(refreshed.lastOpenedAt).not.toBeNull();
  });

  it('removes worktrees when asked and cascades threads', async () => {
    const project = await addProject(ctx.repos, repo);
    addTestProvider(ctx.repos);
    const thread = await createThread(ctx.repos, {
      projectId: project.id,
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
    });
    const worktreePath = thread.worktreePath;
    expect(worktreePath).not.toBeNull();
    expect(existsSync(worktreePath ?? '')).toBe(true);

    await removeProject(ctx.repos, project.id, true);
    expect(ctx.repos.projects.get(project.id)).toBeUndefined();
    expect(ctx.repos.threads.list(project.id)).toHaveLength(0);
    expect(existsSync(worktreePath ?? '')).toBe(false);
  });
});
