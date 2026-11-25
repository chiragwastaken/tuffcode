import type { Project, Thread } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_ITEM_HEIGHT,
  VIRTUALIZE_AFTER,
  buildSidebarItems,
  childThreadLabel,
  filterGroups,
  formatRelativeTime,
  groupThreadsByProject,
  isCouncilChild,
  needsVirtualization,
  readCollapsedProjects,
  sidebarItemHeight,
  sidebarItemKey,
  writeCollapsedProjects,
  type CollapseStore,
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

  it('keeps the root thread when only its child matches', () => {
    const goal = makeThread({ id: 'goal', projectId: 'p1', title: 'Ship the release' });
    const child = makeThread({
      id: 'child',
      projectId: 'p1',
      title: 'Subagent explorer 9f9f0a1b',
      parentThreadId: 'goal',
    });

    const filtered = filterGroups([group(alpha, [goal, child])], 'explorer');

    expect(filtered[0]?.threads.map((thread) => thread.id).toSorted()).toEqual(['child', 'goal']);
  });

  it('keeps every ancestor of a matched grandchild so the row stays reachable', () => {
    const goal = makeThread({ id: 'goal', projectId: 'p1', title: 'Ship the release' });
    const child = makeThread({
      id: 'child',
      projectId: 'p1',
      title: 'Council: Ship the release',
      parentThreadId: 'goal',
    });
    const grandchild = makeThread({
      id: 'grandchild',
      projectId: 'p1',
      title: 'Review: Ship the release',
      parentThreadId: 'child',
    });

    const filtered = filterGroups([group(alpha, [goal, child, grandchild])], 'review');

    expect(filtered[0]?.threads.map((thread) => thread.id).toSorted()).toEqual([
      'child',
      'goal',
      'grandchild',
    ]);
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

  it('lists root threads only and nests children depth first under the parent', () => {
    const root = makeThread({
      id: 'root',
      projectId: 'p1',
      title: 'Root',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const councilChild = makeThread({
      id: 'child-a',
      projectId: 'p1',
      title: 'Council: Add the activity panel',
      parentThreadId: 'root',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    });
    const subagentChild = makeThread({
      id: 'child-b',
      projectId: 'p1',
      title: 'Subagent explorer abcd1234',
      parentThreadId: 'root',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    const grandchild = makeThread({
      id: 'grandchild',
      projectId: 'p1',
      title: 'Review: Add the activity panel',
      parentThreadId: 'child-a',
    });

    const items = buildSidebarItems(
      [group(alpha, [root, councilChild, subagentChild, grandchild])],
      () => false,
    );

    expect(items.map(sidebarItemKey)).toEqual([
      'project:p1',
      'thread:root',
      'child:child-a',
      'child:grandchild',
      'child:child-b',
    ]);
    expect(items[0]).toMatchObject({ kind: 'project', threadCount: 1 });
    const nested = items[3];
    if (nested?.kind !== 'child') throw new Error('Expected a child row for the grandchild.');
    expect(nested).toMatchObject({ parentId: 'child-a', depth: 2 });
  });

  it('caps the indent at three levels while keeping deeper rows nested', () => {
    const root = makeThread({ id: 'root', projectId: 'p1', title: 'Root' });
    const level1 = makeThread({
      id: 'l1',
      projectId: 'p1',
      title: 'Council: Ship the release',
      parentThreadId: 'root',
    });
    const level2 = makeThread({
      id: 'l2',
      projectId: 'p1',
      title: 'Plan: Ship the release',
      parentThreadId: 'l1',
    });
    const level3 = makeThread({
      id: 'l3',
      projectId: 'p1',
      title: 'Review: Ship the release',
      parentThreadId: 'l2',
    });
    const level4 = makeThread({
      id: 'l4',
      projectId: 'p1',
      title: 'Subagent worker 1234abcd',
      parentThreadId: 'l3',
    });

    const items = buildSidebarItems([group(alpha, [root, level1, level2, level3, level4])], () => false);

    expect(items.map(sidebarItemKey)).toEqual([
      'project:p1',
      'thread:root',
      'child:l1',
      'child:l2',
      'child:l3',
      'child:l4',
    ]);
    expect(items.slice(2).map((item) => (item.kind === 'child' ? item.depth : 0))).toEqual([
      1, 2, 3, 3,
    ]);
  });

  it('measures 48px root rows, 44px child rows and 32px for the rest', () => {
    const root = makeThread({ id: 'root', projectId: 'p1', title: 'Root' });
    const child = makeThread({
      id: 'child',
      projectId: 'p1',
      title: 'Subagent worker abcd1234',
      parentThreadId: 'root',
    });

    const items = buildSidebarItems([group(alpha, [root, child])], () => false);

    expect(SIDEBAR_ITEM_HEIGHT).toEqual({ project: 32, thread: 48, child: 44, empty: 32 });
    expect(items.map(sidebarItemHeight)).toEqual([32, 48, 44]);
  });

  it('nests a council child under its goal thread', () => {
    const goal = makeThread({ id: 'goal', projectId: 'p1', title: 'Ship v0.1.3' });
    const worker = makeThread({
      id: 'worker',
      projectId: 'p1',
      title: 'Council: Add the activity panel',
      parentThreadId: 'goal',
    });

    const items = buildSidebarItems([group(alpha, [goal, worker])], () => false);

    expect(items.map(sidebarItemKey)).toEqual(['project:p1', 'thread:goal', 'child:worker']);
    const row = items[2];
    expect(row?.kind).toBe('child');
    if (row?.kind !== 'child') return;
    expect(childThreadLabel(row.thread)).toBe('Council Add the activity panel');
    expect(isCouncilChild(row.thread)).toBe(true);
  });
});

describe('child thread labels', () => {
  it('names a subagent by its type', () => {
    expect(
      childThreadLabel(
        makeThread({
          id: 'child',
          projectId: 'p1',
          title: 'Subagent reviewer 1a2b3c4d',
          parentThreadId: 'root',
        }),
      ),
    ).toBe('Reviewer');
  });

  it('shortens council stage titles', () => {
    const label = (title: string): string =>
      childThreadLabel(makeThread({ id: 'child', projectId: 'p1', title, parentThreadId: 'root' }));

    expect(label('Council: Add tests')).toBe('Council Add tests');
    expect(label('Review: Add tests')).toBe('Review Add tests');
    expect(label('Plan: Add tests')).toBe('Plan Add tests');
  });

  it('keeps the plain title and treats a blank title as untitled', () => {
    const label = (title: string): string =>
      childThreadLabel(makeThread({ id: 'child', projectId: 'p1', title, parentThreadId: 'root' }));

    expect(label('  Plain child  ')).toBe('Plain child');
    expect(label('   ')).toBe('Untitled thread');
    expect(label('Subagent unknown 1a2b')).toBe('Subagent unknown 1a2b');
  });
});

describe('needsVirtualization', () => {
  it('stays off at the threshold', () => {
    expect(needsVirtualization(groupsWithThreadCount(VIRTUALIZE_AFTER))).toBe(false);
  });

  it('turns on above the threshold', () => {
    expect(needsVirtualization(groupsWithThreadCount(VIRTUALIZE_AFTER + 1))).toBe(true);
  });

  it('counts rows across projects, not per project', () => {
    const alpha = makeProject({ id: 'p1', name: 'Alpha' });
    const beta = makeProject({ id: 'p2', name: 'Beta' });
    const threads = (projectId: string, count: number): Thread[] =>
      Array.from({ length: count }, (_, index) =>
        makeThread({ id: `${projectId}-${index}`, projectId, title: `Thread ${index}` }),
      );

    expect(
      needsVirtualization([group(alpha, threads('p1', 50)), group(beta, threads('p2', 50))]),
    ).toBe(false);
    expect(
      needsVirtualization([group(alpha, threads('p1', 60)), group(beta, threads('p2', 41))]),
    ).toBe(true);
  });
});

function memoryStore(initial: Record<string, string> = {}): CollapseStore {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('collapsed project preference', () => {
  it('defaults to nothing collapsed', () => {
    expect(readCollapsedProjects(memoryStore())).toEqual(new Set());
  });

  it('round-trips the collapsed project ids', () => {
    const storage = memoryStore();

    writeCollapsedProjects(storage, new Set(['p1', 'p3']));
    expect(readCollapsedProjects(storage)).toEqual(new Set(['p1', 'p3']));

    writeCollapsedProjects(storage, new Set());
    expect(readCollapsedProjects(storage)).toEqual(new Set());
  });

  it('ignores malformed or non-string entries', () => {
    expect(readCollapsedProjects(memoryStore({ [SIDEBAR_COLLAPSED_KEY]: '{' }))).toEqual(new Set());
    expect(readCollapsedProjects(memoryStore({ [SIDEBAR_COLLAPSED_KEY]: '{"p1":true}' }))).toEqual(
      new Set(),
    );
    expect(
      readCollapsedProjects(memoryStore({ [SIDEBAR_COLLAPSED_KEY]: '["p1",7,null,"p2"]' })),
    ).toEqual(new Set(['p1', 'p2']));
  });

  it('forgets the preference when storage is missing or throws', () => {
    const broken: CollapseStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readCollapsedProjects(null)).toEqual(new Set());
    expect(readCollapsedProjects(broken)).toEqual(new Set());
    expect(() => writeCollapsedProjects(broken, new Set(['p1']))).not.toThrow();
    expect(() => writeCollapsedProjects(null, new Set(['p1']))).not.toThrow();
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-24T12:00:00.000Z');

  it('renders compact minutes, hours and days', () => {
    expect(formatRelativeTime('2026-11-24T11:59:30.000Z', now)).toBe('now');
    expect(formatRelativeTime('2026-11-24T11:55:00.000Z', now)).toBe('5m');
    expect(formatRelativeTime('2026-11-24T09:00:00.000Z', now)).toBe('3h');
    expect(formatRelativeTime('2026-11-22T12:00:00.000Z', now)).toBe('2d');
  });

  it('falls back to a calendar date after a week', () => {
    const date = formatRelativeTime('2026-11-01T12:00:00.000Z', now);
    expect(date).not.toMatch(/^\d+[mhd]$/);
    expect(date.length).toBeGreaterThan(0);
  });

  it('renders nothing for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
