import { ABOUT_USER_HEADING, assemblePrompt, buildPersonalSection } from '@tuffcode/prompt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support.js';
import { createBrainRpcHandlers } from './handlers.js';

const ISO = '2026-11-25T10:00:00.000Z';
const turnContext = { date: '2026-11-25', mode: 'work' as const, cwd: 'D:/repo', projectName: 'demo', brainSlice: '' };

describe('Your Tuffcode prompt section', () => {
  it('renders the profile and style and is absent when empty', () => {
    expect(buildPersonalSection({ name: '', role: '', about: '' })).toBeUndefined();
    expect(buildPersonalSection({ name: '  Chirag ', role: 'Maintainer', about: 'Ships Windows-first.' }, 'concise')).toBe(
      [
        'Name: Chirag (address the user this way).',
        'Role: Maintainer.',
        'Ships Windows-first.',
        'Prefers short answers: lead with the result and skip background unless asked.',
      ].join('\n'),
    );
    const assembled = assemblePrompt({
      profile: { name: 'Sam', role: '', about: '' },
      customInstructions: 'Use pnpm.',
      turnContext,
      userMessage: 'hi',
    });
    expect(assembled.sections.map((section) => section.name)).toEqual([
      'base',
      'about-user',
      'custom-instructions',
      'turn-context',
      'user-message',
    ]);
    expect(assembled.systemPrompt).toContain(`${ABOUT_USER_HEADING}\nName: Sam`);
  });
});

describe('brain reset', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = createTestContext();
    for (const id of ['prj_a', 'prj_b']) {
      ctx.repos.projects.add({ id, name: id, path: `${ctx.env.root}/${id}`, defaultBranch: 'main', createdAt: ISO });
    }
  });
  afterEach(() => ctx.dispose());

  it('removes one project or everything, edges included', async () => {
    const a = ctx.repos.brain.upsert({ kind: 'project', scope: 'project', projectId: 'prj_a', text: 'uses pnpm' });
    const b = ctx.repos.brain.upsert({ kind: 'project', scope: 'project', projectId: 'prj_b', text: 'uses bun' });
    ctx.repos.brain.upsert({ kind: 'preference', scope: 'global', text: 'short answers' });
    ctx.repos.brain.upsertEdge({ from: a.id, to: b.id, relation: 'about' });
    const reset = createBrainRpcHandlers({ repos: ctx.repos }).get('brain.reset');
    expect(await reset?.({ projectId: 'prj_a' })).toEqual({ removed: 1 });
    expect(ctx.repos.brain.listEdges()).toEqual([]);
    expect(ctx.repos.brain.list({ includeInactive: true }).map((entry) => entry.text).toSorted()).toEqual([
      'short answers',
      'uses bun',
    ]);
    expect(await reset?.({})).toEqual({ removed: 2 });
    expect(ctx.repos.brain.list({ includeInactive: true })).toEqual([]);
  });
});
