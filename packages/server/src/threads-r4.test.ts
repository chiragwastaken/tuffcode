import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CAPABILITIES } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTestProvider, createTestContext, type TestContext } from './test-support.js';
import { createThread, deleteThread, searchThreads } from './threads.js';

const ISO = '2026-11-25T10:00:00.000Z';

describe('threads round 4', () => {
  let ctx: TestContext;
  let projectPath: string;

  beforeEach(() => {
    ctx = createTestContext();
    projectPath = join(ctx.env.root, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, 'README.md'), '# keep me\n');
    ctx.repos.projects.add({ id: 'prj', name: 'p', path: projectPath, defaultBranch: 'main', createdAt: ISO });
    addTestProvider(ctx.repos);
  });
  afterEach(() => ctx.dispose());

  it('runs in the project checkout when worktrees are off and never deletes it', async () => {
    ctx.repos.settings.patch({ capabilities: { ...DEFAULT_CAPABILITIES, worktrees: false } });
    const thread = await createThread(ctx.repos, {
      projectId: 'prj',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
    });
    expect(thread.worktreePath).toBe(projectPath);
    expect(thread.branch).toBeNull();
    expect(thread.title).toBe('New chat');
    await deleteThread(ctx.repos, thread.id, true);
    expect(ctx.repos.threads.get(thread.id)).toBeUndefined();
    expect(existsSync(join(projectPath, 'README.md'))).toBe(true);
  });

  it('finds threads by title first and by message text after', () => {
    const make = (id: string, title: string): void => {
      ctx.repos.threads.create({
        id,
        projectId: 'prj',
        parentThreadId: null,
        title,
        providerId: 'prv_test',
        modelId: 'm',
        executionMode: 'work',
        permissionMode: 'ask',
        status: 'idle',
        worktreePath: null,
        branch: null,
        baseBranch: null,
        createdAt: ISO,
        updatedAt: ISO,
      });
    };
    make('t1', 'Fix login flow');
    make('t2', 'Refactor runner');
    ctx.repos.messages.add({
      id: 'm1',
      threadId: 't2',
      role: 'user',
      content: 'the login test is flaky after the runner change and it fails on Windows only',
      createdAt: ISO,
    });
    const hits = searchThreads(ctx.repos, 'login');
    expect(hits.map((hit) => [hit.threadId, hit.matchedIn])).toEqual([
      ['t1', 'title'],
      ['t2', 'message'],
    ]);
    expect(hits[1]?.snippet).toContain('login test is flaky');
    expect(searchThreads(ctx.repos, '   ')).toEqual([]);
  });
});
