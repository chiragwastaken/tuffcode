import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test-support.js';
import { likePattern } from './messages.js';

const ISO = '2026-11-25T10:00:00.000Z';
const LATER = '2026-11-25T11:00:00.000Z';

function seedThread(ctx: TestContext, id: string, title: string): void {
  ctx.repos.threads.create({
    id,
    projectId: 'prj_a',
    parentThreadId: null,
    title,
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
}

describe('round 4 repos', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    seedThread(ctx, 'thr_a', 'alpha thread');
  });

  afterEach(() => ctx.dispose());

  it('moves a thread to another provider and sets or clears its reasoning level', () => {
    expect(ctx.repos.threads.get('thr_a')?.reasoningEffort).toBeNull();
    const moved = ctx.repos.threads.update('thr_a', {
      providerId: 'prv_other',
      modelId: 'gpt-5',
      reasoningEffort: 'xhigh',
      updatedAt: LATER,
    });
    expect(moved).toMatchObject({ providerId: 'prv_other', modelId: 'gpt-5', reasoningEffort: 'xhigh' });
    const kept = ctx.repos.threads.update('thr_a', { title: 'renamed', updatedAt: LATER });
    expect(kept?.reasoningEffort).toBe('xhigh');
    const cleared = ctx.repos.threads.update('thr_a', { reasoningEffort: null, updatedAt: LATER });
    expect(cleared?.reasoningEffort).toBeNull();
  });

  it('stores one todo list per thread and replaces it on write', () => {
    expect(ctx.repos.todos.get('thr_a')).toBeUndefined();
    ctx.repos.todos.set(
      'thr_a',
      [{ name: 'Tasks', tasks: [{ content: 'write tests', status: 'pending' }] }],
      ISO,
    );
    ctx.repos.todos.set(
      'thr_a',
      [{ name: 'Tasks', tasks: [{ content: 'write tests', status: 'completed' }] }],
      LATER,
    );
    expect(ctx.repos.todos.get('thr_a')).toEqual({
      phases: [{ name: 'Tasks', tasks: [{ content: 'write tests', status: 'completed' }] }],
      updatedAt: LATER,
    });
    ctx.repos.threads.remove('thr_a');
    expect(ctx.repos.todos.get('thr_a')).toBeUndefined();
  });

  it('searches messages literally and returns one hit per thread', () => {
    seedThread(ctx, 'thr_b', 'beta thread');
    const add = (id: string, threadId: string, content: string, createdAt: string): void => {
      ctx.repos.messages.add({ id, threadId, role: 'user', content, createdAt });
    };
    add('m1', 'thr_a', 'fix the 100% flaky login test', ISO);
    add('m2', 'thr_a', 'login again', LATER);
    add('m3', 'thr_b', 'LOGIN page copy', ISO);
    add('m4', 'thr_b', 'unrelated', LATER);
    const hits = ctx.repos.messages.search('login', 10);
    expect(hits.map((hit) => hit.threadId).toSorted()).toEqual(['thr_a', 'thr_b']);
    expect(ctx.repos.messages.search('100%', 10).map((hit) => hit.id)).toEqual(['m1']);
    expect(ctx.repos.messages.search('_', 10)).toEqual([]);
    expect(likePattern('a%b_c\\')).toBe('%a\\%b\\_c\\\\%');
  });

  it('installs, toggles and removes a plugin, and keeps user marketplaces', () => {
    const plugin = ctx.repos.plugins.insert({
      id: 'plg_1',
      marketplaceId: 'official',
      name: 'github',
      displayName: 'GitHub',
      description: 'Issues and pull requests',
      version: '1.0.0',
      kind: 'plugin',
      enabled: true,
      installPath: 'C:/plugins/official/github',
      components: { skills: ['triage'], commands: [], mcpServers: ['github'], agents: [], hooks: false },
      source: 'marketplace',
      installedAt: ISO,
    });
    expect(ctx.repos.plugins.findByName('official', 'github')).toEqual(plugin);
    expect(ctx.repos.plugins.findByName(null, 'github')).toBeUndefined();
    expect(() => ctx.repos.plugins.insert({ ...plugin, id: 'plg_2' })).toThrow();
    expect(ctx.repos.plugins.setEnabled('plg_1', false)?.enabled).toBe(false);
    ctx.repos.plugins.remove('plg_1');
    expect(ctx.repos.plugins.list()).toEqual([]);

    ctx.repos.plugins.addMarketplace({
      id: 'mkt_1',
      label: 'acme/plugins',
      url: 'acme/plugins',
      verified: false,
      createdAt: ISO,
    });
    expect(ctx.repos.plugins.listMarketplaces().map((row) => row.url)).toEqual(['acme/plugins']);
    ctx.repos.plugins.removeMarketplace('mkt_1');
    expect(ctx.repos.plugins.listMarketplaces()).toEqual([]);
  });
});
