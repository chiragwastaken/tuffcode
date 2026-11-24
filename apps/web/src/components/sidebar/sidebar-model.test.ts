import type { Project, Thread } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  VIRTUALIZE_AFTER,
  buildSidebarItems,
  filterGroups,
  groupThreadsByProject,
  needsVirtualization,
  sidebarItemKey,
  threadStatusBadge,
  type ProjectThreadGroup,
} from './sidebar-model';

const baseProject: Project = {
  id: 'p1',
  name: 'Tuffcode',
  path: 'C:/work/tuffcode',
  defaultBranch: 'main',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
};

function makeProject(overrides: Partial<Project> & { id: string; name: string }): Project {
  return { ...baseProject, ...overrides };
}

function makeThread(
  overrides: Partial<Thread> & { id: string; projectId: string; title: string },
): Thread {
  return {
    parentThreadId: null,
    providerId: 'provider-1',
    modelId: 'model-1',
    executionMode: 'work',
    permissionMode: 'ask',
    status: 'idle',
    worktreePath: null,
    branch: null,
    baseBranch: null,
    prUrl: null,
    lastSeq: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function group(project: Project, threads: Thread[]): ProjectThreadGroup {
  return { project, threads };
}

function groupsWithThreadCount(count: number): ProjectThreadGroup[] {
  const project = makeProject({ id: 'p1', name: 'Alpha' });
  const threads = Array.from({ length: count }, (_, index) =>
    makeThread({ id: `t${index}`, projectId: 'p1', title: `Thread ${index}` }),
  );
  return [group(project, threads)];
}

describe('groupThreadsByProject', () => {
  it('groups threads under their project and sorts newest first', () => {
    const alpha = makeProject({ id: 'p1', name: 'Alpha' });
    const beta = makeProject({ id: 'p2', name: 'Beta' });
    const groups = groupThreadsByProject(
      [alpha, beta],
      [
        makeThread({
          id: 't1',
          projectId: 'p1',
          title: 'Older',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeThread({
          id: 't2',
          projectId: 'p1',
          title: 'Newer',
          updatedAt: '2026-02-01T00:00:00.000Z',
        }),
        makeThread({ id: 't3', projectId: 'p2', title: 'Beta thread' }),
      ],
    );

    expect(groups.map((entry) => entry.project.id)).toEqual(['p1', 'p2']);
    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(['t2', 't1']);
    expect(groups[1]?.threads.map((thread) => thread.id)).toEqual(['t3']);
  });

  it('keeps projects without threads and drops threads from unknown projects', () => {
    const groups = groupThreadsByProject(
      [makeProject({ id: 'p1', name: 'Alpha' }), makeProject({ id: 'p2', name: 'Beta' })],
      [makeThread({ id: 't1', projectId: 'p1', title: 'Alpha thread' })],
    );

    expect(groups.map((entry) => entry.project.id)).toEqual(['p1', 'p2']);
    expect(groups[1]?.threads).toEqual([]);
  });

  it('breaks updatedAt ties by thread id', () => {
    const groups = groupThreadsByProject(
      [makeProject({ id: 'p1', name: 'Alpha' })],
      [
        makeThread({ id: 'b', projectId: 'p1', title: 'B' }),
        makeThread({ id: 'a', projectId: 'p1', title: 'A' }),
      ],
    );

    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(['a', 'b']);
  });
});

describe('filterGroups', () => {
  const alpha = makeProject({ id: 'p1', name: 'Alpha App' });
  const beta = makeProject({ id: 'p2', name: 'Beta Service' });
  const groups = [
    group(alpha, [
      makeThread({ id: 't1', projectId: 'p1', title: 'Fix login redirect' }),
      makeThread({ id: 't2', projectId: 'p1', title: 'Add dark mode' }),
    ]),
    group(beta, [makeThread({ id: 't3', projectId: 'p2', title: 'Retry websocket' })]),
  ];

  it('returns every group when the query is blank', () => {
    expect(filterGroups(groups, '   ')).toEqual(groups);
  });

  it('matches project names and keeps every thread in that project', () => {
    const filtered = filterGroups(groups, 'alpha');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.project.id).toBe('p1');
    expect(filtered[0]?.threads.map((thread) => thread.id)).toEqual(['t1', 't2']);
  });

  it('narrows to matching thread titles and drops empty groups', () => {
    const filtered = filterGroups(groups, 'DARK');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.project.id).toBe('p1');
    expect(filtered[0]?.threads.map((thread) => thread.id)).toEqual(['t2']);
  });

  it('ignores surrounding whitespace and case', () => {
    expect(filterGroups(groups, '  retry  ')[0]?.project.id).toBe('p2');
  });

  it('returns no groups when nothing matches', () => {
    expect(filterGroups(groups, 'zzz')).toEqual([]);
  });
});

describe('threadStatusBadge', () => {
  it('labels the four live statuses with their design tones', () => {
    expect(threadStatusBadge('running')).toEqual({ label: 'Running', tone: 'running' });
    expect(threadStatusBadge('needs-approval')).toEqual({
      label: 'Needs approval',
      tone: 'warning',
    });
    expect(threadStatusBadge('ready-to-review')).toEqual({
      label: 'Ready to review',
      tone: 'success',
    });
    expect(threadStatusBadge('failed')).toEqual({ label: 'Failed', tone: 'error' });
  });

  it('omits badges for quiet statuses', () => {
    expect(threadStatusBadge('idle')).toBeNull();
    expect(threadStatusBadge('merged')).toBeNull();
    expect(threadStatusBadge('closed')).toBeNull();
  });
});

describe('buildSidebarItems', () => {
  const alpha = makeProject({ id: 'p1', name: 'Alpha' });
  const beta = makeProject({ id: 'p2', name: 'Beta' });

  it('emits a project row followed by its thread rows', () => {
    const items = buildSidebarItems(
      [
        group(alpha, [makeThread({ id: 't1', projectId: 'p1', title: 'One' })]),
        group(beta, [makeThread({ id: 't2', projectId: 'p2', title: 'Two' })]),
      ],
      () => false,
    );

    expect(items.map(sidebarItemKey)).toEqual([
      'project:p1',
      'thread:t1',
      'project:p2',
      'thread:t2',
    ]);
  });

  it('hides thread rows for collapsed projects', () => {
    const items = buildSidebarItems(
      [group(alpha, [makeThread({ id: 't1', projectId: 'p1', title: 'One' })])],
      (projectId) => projectId === 'p1',
    );

    expect(items.map(sidebarItemKey)).toEqual(['project:p1']);
    expect(items[0]).toMatchObject({ kind: 'project', collapsed: true, threadCount: 1 });
  });

  it('adds an empty row for expanded projects without threads', () => {
    const items = buildSidebarItems([group(alpha, [])], () => false);
    expect(items.map(sidebarItemKey)).toEqual(['project:p1', 'empty:p1']);
  });
});

describe('needsVirtualization', () => {
  it('stays off at the threshold', () => {
    expect(needsVirtualization(groupsWithThreadCount(VIRTUALIZE_AFTER))).toBe(false);
  });

  it('turns on above the threshold', () => {
    expect(needsVirtualization(groupsWithThreadCount(VIRTUALIZE_AFTER + 1))).toBe(true);
  });
});
