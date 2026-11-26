import { join } from 'node:path';
import { DEFAULT_CAPABILITIES } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WorktreeModule from './git/worktree.js';
import type { ProvisionedWorktree, ProvisionWorktreeInput } from './git/worktree.js';
import { addProject } from './projects.js';
import { addTestProvider, createTestContext, initRepo, type TestContext } from './test-support.js';
import { createThread } from './threads.js';

/**
 * The provisioner is wrapped so a test can hold a call open and observe whether a
 * second create waits for it. Without the override the real git path runs.
 */
const worktreeState = vi.hoisted(() => ({
  calls: 0,
  active: 0,
  maxActive: 0,
  override: null as null | ((input: ProvisionWorktreeInput) => Promise<ProvisionedWorktree>),
}));

vi.mock('./git/worktree.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreeModule>();
  return {
    ...actual,
    provisionWorktree: async (input: ProvisionWorktreeInput): Promise<ProvisionedWorktree> => {
      worktreeState.calls += 1;
      worktreeState.active += 1;
      worktreeState.maxActive = Math.max(worktreeState.maxActive, worktreeState.active);
      try {
        if (worktreeState.override !== null) return await worktreeState.override(input);
        return await actual.provisionWorktree(input);
      } finally {
        worktreeState.active -= 1;
      }
    },
  };
});

describe('thread workspace selection', () => {
  let ctx: TestContext;
  let repo: string;

  beforeEach(() => {
    ctx = createTestContext();
    repo = initRepo(join(ctx.env.root, 'workspace-repo'));
    addTestProvider(ctx.repos);
    worktreeState.calls = 0;
    worktreeState.active = 0;
    worktreeState.maxActive = 0;
    worktreeState.override = null;
  });

  afterEach(() => {
    worktreeState.override = null;
    ctx.dispose();
  });

  async function create(workspace?: 'folder' | 'worktree') {
    const project = await addProject(ctx.repos, repo);
    return createThread(ctx.repos, {
      projectId: project.id,
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      ...(workspace === undefined ? {} : { workspace }),
    });
  }

  it('folder creation runs in the project path and never calls the provisioner', async () => {
    const thread = await create('folder');
    expect(worktreeState.calls).toBe(0);
    expect(thread.worktreePath).not.toBeNull();
    expect(thread.branch).toBeNull();
  });

  it('worktree creation still calls the provisioner', async () => {
    const thread = await create('worktree');
    expect(worktreeState.calls).toBe(1);
    expect(thread.branch).toBe(`tuffcode/${thread.id}`);
  });

  it('forces folder when the capability is off even if a worktree was requested', async () => {
    ctx.repos.settings.patch({ capabilities: { ...DEFAULT_CAPABILITIES, worktrees: false } });
    const thread = await create('worktree');
    expect(worktreeState.calls).toBe(0);
    expect(thread.branch).toBeNull();
    expect(thread.worktreePath).not.toBeNull();
  });

  it('serializes concurrent provisioning', async () => {
    const started: Array<PromiseWithResolvers<void>> = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    let invocation = 0;
    worktreeState.override = async (input) => {
      const gate = started[invocation];
      invocation += 1;
      gate?.resolve();
      await gate?.promise;
      return {
        path: join(ctx.env.root, 'worktrees', input.projectId, input.threadId),
        branch: `tuffcode/${input.threadId}`,
        baseBranch: input.baseBranch,
      };
    };
    const project = await addProject(ctx.repos, repo);
    const request = {
      projectId: project.id,
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work' as const,
      permissionMode: 'ask' as const,
      workspace: 'worktree' as const,
    };

    const first = createThread(ctx.repos, request);
    const second = createThread(ctx.repos, request);
    await started[0]?.promise;
    // The second create must not have reached `git worktree add` yet.
    expect(worktreeState.calls).toBe(1);
    expect(invocation).toBe(1);

    started[0]?.resolve();
    await first;
    await started[1]?.promise;
    expect(worktreeState.calls).toBe(2);
    expect(invocation).toBe(2);

    started[1]?.resolve();
    await second;
    expect(worktreeState.maxActive).toBe(1);
  });
});
