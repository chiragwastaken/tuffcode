import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectThread,
  createTestContext,
  initRepo,
  type ProjectThread,
  type TestContext,
} from './test-support.js';
import {
  DEFAULT_THREAD_TITLE,
  backfillTitles,
  deriveTitle,
  isPlaceholderTitle,
  subagentTitle,
} from './titles.js';

describe('deriveTitle', () => {
  it.each([
    ['fix the flaky login test in auth.ts please', 'Fix the flaky login test in auth.ts'],
    ['please fix X', 'Fix X'],
    ['Can you add dark mode to the settings page?', 'Add dark mode to the settings page'],
    ['hey, launch a subagent to test, make it say hi', 'Launch a subagent to test, make it say hi'],
    ['/review src/a.ts', 'Src/a.ts'],
    ['$deploy ship the staging build now. Then tell me.', 'Ship the staging build now'],
    ['see https://example.com/issue/42 for the crash in the runner', 'See for the crash in the runner'],
    ['```ts\nconst a = 1;\n```', null],
    ['`foo()` breaks when the cache is empty', 'Breaks when the cache is empty'],
    ['   \n\t  ', null],
    ['🎉🎉', null],
    ['überprüfe die Übersetzung der Startseite', 'Überprüfe die Übersetzung der Startseite'],
  ])('%j -> %j', (input, expected) => {
    expect(deriveTitle(input)).toBe(expected);
  });

  it('cuts a long sentence at a word boundary under the limit', () => {
    const title = deriveTitle(
      'refactor the provider discovery service so that every adapter reports its models through one normalized path',
    );
    expect(title).not.toBeNull();
    expect(title?.length).toBeLessThanOrEqual(60);
    expect(title).toBe('Refactor the provider discovery service so that every');
  });

  it('keeps only the first line of a multi-line prompt', () => {
    expect(deriveTitle('Investigate the memory leak\n\nIt happens after 2 hours of use.')).toBe(
      'Investigate the memory leak',
    );
  });
});

describe('titles', () => {
  it('treats the default, the legacy id titles and empty text as placeholders', () => {
    expect(isPlaceholderTitle(DEFAULT_THREAD_TITLE)).toBe(true);
    expect(isPlaceholderTitle('Thread 119d3f0a')).toBe(true);
    expect(isPlaceholderTitle('Subagent explorer 4b2c9d1e')).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle('Thread safety review')).toBe(false);
    expect(isPlaceholderTitle('Fix login')).toBe(false);
  });

  it('labels a subagent child by its type and task', () => {
    expect(subagentTitle('explorer', 'map the runner send path and its callers')).toBe(
      'Explorer: Map the runner send path and its callers',
    );
    expect(subagentTitle('worker', '```\n```')).toBe('Worker subagent');
  });
});

describe('backfillTitles', () => {
  const ISO = '2026-11-24T10:00:00.000Z';
  let ctx: TestContext;
  let setup: ProjectThread;

  beforeEach(async () => {
    ctx = createTestContext();
    setup = await createProjectThread(ctx.repos, initRepo(join(ctx.env.root, 'titles-repo')));
  });

  afterEach(() => {
    ctx.dispose();
  });

  function firstMessage(content: string): void {
    ctx.repos.messages.add({
      id: 'msg_first',
      threadId: setup.thread.id,
      role: 'user',
      content,
      createdAt: ISO,
    });
  }

  it('repairs a legacy id title from the first user message', () => {
    firstMessage('please fix the flaky login test in auth.ts');
    ctx.repos.threads.update(setup.thread.id, { title: 'Thread 119d3f0a', updatedAt: ISO });

    expect(backfillTitles(ctx.repos)).toBe(1);
    expect(ctx.repos.threads.get(setup.thread.id)?.title).toBe('Fix the flaky login test in auth.ts');
    // The repaired title is no longer a placeholder, so a second startup is a no-op.
    expect(backfillTitles(ctx.repos)).toBe(0);
  });

  it('keeps a title the user chose', () => {
    firstMessage('fix the flaky login test');
    ctx.repos.threads.update(setup.thread.id, { title: 'Login work', updatedAt: ISO });

    expect(backfillTitles(ctx.repos)).toBe(0);
    expect(ctx.repos.threads.get(setup.thread.id)?.title).toBe('Login work');
  });

  it('leaves a placeholder alone when the thread has no user message', () => {
    ctx.repos.threads.update(setup.thread.id, { title: 'Thread deadbeef', updatedAt: ISO });

    expect(backfillTitles(ctx.repos)).toBe(0);
    expect(ctx.repos.threads.get(setup.thread.id)?.title).toBe('Thread deadbeef');
  });

  it('names a subagent child from its type and task', () => {
    const child = ctx.repos.threads.create({
      id: 'thr_child',
      projectId: setup.project.id,
      parentThreadId: setup.thread.id,
      title: 'Subagent explorer 4b2c9d1e',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
    ctx.repos.subagents.create({
      childId: 'sub_explorer',
      threadId: setup.thread.id,
      type: 'explorer',
      providerId: 'prv_test',
      model: 'model-x',
      status: 'done',
      task: 'map the runner send path and its callers',
      createdAt: ISO,
    });
    ctx.repos.subagents.setRunning('sub_explorer', child.id, ISO);

    expect(backfillTitles(ctx.repos)).toBe(1);
    expect(ctx.repos.threads.get(child.id)?.title).toBe(
      'Explorer: Map the runner send path and its callers',
    );
  });
});
