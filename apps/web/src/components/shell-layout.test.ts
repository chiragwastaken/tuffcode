import { describe, expect, it } from 'vitest';
import {
  WINDOW_CONTROLS_INSET_WIN32,
  isSettingsPath,
  resolveRootView,
  shellVisibility,
  windowControlsInset,
} from './shell-layout';
import type { Project, Thread } from '@tuffcode/contracts';

function project(id: string, lastOpenedAt: string | null = null): Project {
  return {
    id,
    name: id,
    path: `C:/repos/${id}`,
    defaultBranch: 'main',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt,
  };
}

function thread(id: string, projectId: string, updatedAt: string): Thread {
  return {
    id,
    projectId,
    parentThreadId: null,
    title: id,
    providerId: 'prov_1',
    modelId: 'model-1',
    executionMode: 'work',
    permissionMode: 'ask',
    status: 'idle',
    worktreePath: null,
    branch: null,
    baseBranch: null,
    prUrl: null,
    reasoningEffort: null,
    lastSeq: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('resolveRootView', () => {
  it('shows the workspace empty state when no project is open', () => {
    expect(resolveRootView({ projects: [], threads: {}, activeThreadId: null })).toEqual({
      kind: 'empty-workspace',
    });
  });

  it('redirects to the active thread', () => {
    expect(
      resolveRootView({
        projects: [project('proj_1')],
        threads: {
          thr_a: thread('thr_a', 'proj_1', '2026-01-02T00:00:00.000Z'),
          thr_b: thread('thr_b', 'proj_1', '2026-01-03T00:00:00.000Z'),
        },
        activeThreadId: 'thr_a',
      }),
    ).toEqual({ kind: 'redirect', projectId: 'proj_1', threadId: 'thr_a' });
  });

  it('falls back to the most recently updated thread', () => {
    expect(
      resolveRootView({
        projects: [project('proj_1')],
        threads: {
          thr_a: thread('thr_a', 'proj_1', '2026-01-02T00:00:00.000Z'),
          thr_b: thread('thr_b', 'proj_1', '2026-01-05T00:00:00.000Z'),
        },
        activeThreadId: null,
      }),
    ).toEqual({ kind: 'redirect', projectId: 'proj_1', threadId: 'thr_b' });
  });

  it('ignores the active thread when its project is gone', () => {
    expect(
      resolveRootView({
        projects: [project('proj_1')],
        threads: {
          stale: thread('stale', 'proj_removed', '2026-01-09T00:00:00.000Z'),
          live: thread('live', 'proj_1', '2026-01-02T00:00:00.000Z'),
        },
        activeThreadId: 'stale',
      }),
    ).toEqual({ kind: 'redirect', projectId: 'proj_1', threadId: 'live' });
  });

  it('asks for a thread when the project has none', () => {
    expect(
      resolveRootView({
        projects: [project('proj_1')],
        threads: {},
        activeThreadId: null,
      }),
    ).toEqual({ kind: 'no-threads' });
  });
});

describe('windowControlsInset', () => {
  it('reserves the caption button zone on win32', () => {
    expect(windowControlsInset('win32')).toBe(140);
    expect(WINDOW_CONTROLS_INSET_WIN32).toBe(140);
  });

  it('reserves nothing on other platforms', () => {
    expect(windowControlsInset('darwin')).toBe(0);
    expect(windowControlsInset('linux')).toBe(0);
    expect(windowControlsInset(undefined)).toBe(0);
    expect(windowControlsInset(null)).toBe(0);
  });
});

describe('settings route visibility', () => {
  it('hides the sidebar and inspector under /settings', () => {
    expect(shellVisibility('/settings')).toEqual({
      sidebar: false,
      inspector: false,
      backToWorkspace: true,
    });
    expect(shellVisibility('/settings/providers')).toEqual({
      sidebar: false,
      inspector: false,
      backToWorkspace: true,
    });
  });

  it('keeps both panels on workspace routes', () => {
    expect(shellVisibility('/')).toEqual({
      sidebar: true,
      inspector: true,
      backToWorkspace: false,
    });
    expect(shellVisibility('/project/proj_1/thread/thr_a')).toEqual({
      sidebar: true,
      inspector: true,
      backToWorkspace: false,
    });
  });

  it('does not treat lookalike paths as settings', () => {
    expect(isSettingsPath('/settingsfoo')).toBe(false);
    expect(shellVisibility('/settingsfoo').sidebar).toBe(true);
  });
});
