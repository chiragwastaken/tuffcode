import type { Project, Thread, ThreadStatus } from '@tuffcode/contracts';
import { STATUS_LABEL, type StatusTone } from '@tuffcode/ui';

/** A project plus the threads that belong to it, newest first. */
export interface ProjectThreadGroup {
  project: Project;
  threads: Thread[];
}

/** Statuses loud enough to earn a badge next to the row title. */
const BADGE_TONE: Partial<Record<ThreadStatus, StatusTone>> = {
  running: 'running',
  'needs-approval': 'warning',
  'ready-to-review': 'success',
  failed: 'error',
};

export interface ThreadStatusBadge {
  label: string;
  tone: StatusTone;
}

/**
 * Maps a thread status onto the badge shown in the rail, or null for quiet
 * statuses that only need the status dot.
 */
export function threadStatusBadge(status: ThreadStatus): ThreadStatusBadge | null {
  const tone = BADGE_TONE[status];
  return tone ? { label: STATUS_LABEL[status], tone } : null;
}

/** Groups threads under their project, keeping the caller's project order. */
export function groupThreadsByProject(
  projects: readonly Project[],
  threads: Iterable<Thread>,
): ProjectThreadGroup[] {
  const groups = new Map<string, ProjectThreadGroup>();
  for (const project of projects) {
    groups.set(project.id, { project, threads: [] });
  }

  for (const thread of threads) {
    groups.get(thread.projectId)?.threads.push(thread);
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.threads.sort(compareThreads);
  }
  return result;
}

function compareThreads(a: Thread, b: Thread): number {
  const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  return a.id.localeCompare(b.id);
}

/**
 * Filters groups by project name or thread title. A project name match keeps
 * every thread in that project; a title match keeps only the matching threads.
 */
export function filterGroups(
  groups: readonly ProjectThreadGroup[],
  query: string,
): ProjectThreadGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...groups];

  const filtered: ProjectThreadGroup[] = [];
  for (const group of groups) {
    if (group.project.name.toLowerCase().includes(needle)) {
      filtered.push(group);
      continue;
    }

    const threads = group.threads.filter((thread) => thread.title.toLowerCase().includes(needle));
    if (threads.length > 0) {
      filtered.push({ project: group.project, threads });
    }
  }
  return filtered;
}

/** A project row, a thread row, or the placeholder shown for an empty project. */
export type SidebarItem =
  | { kind: 'project'; project: Project; threadCount: number; collapsed: boolean }
  | { kind: 'thread'; thread: Thread }
  | { kind: 'empty'; projectId: string };

export function buildSidebarItems(
  groups: readonly ProjectThreadGroup[],
  isCollapsed: (projectId: string) => boolean,
): SidebarItem[] {
  const items: SidebarItem[] = [];
  for (const group of groups) {
    const collapsed = isCollapsed(group.project.id);
    items.push({
      kind: 'project',
      project: group.project,
      threadCount: group.threads.length,
      collapsed,
    });
    if (collapsed) continue;

    if (group.threads.length === 0) {
      items.push({ kind: 'empty', projectId: group.project.id });
      continue;
    }

    for (const thread of group.threads) {
      items.push({ kind: 'thread', thread });
    }
  }
  return items;
}

export function sidebarItemKey(item: SidebarItem): string {
  switch (item.kind) {
    case 'project':
      return `project:${item.project.id}`;
    case 'thread':
      return `thread:${item.thread.id}`;
    case 'empty':
      return `empty:${item.projectId}`;
  }
}

export const SIDEBAR_ITEM_HEIGHT: Record<SidebarItem['kind'], number> = {
  project: 32,
  thread: 36,
  empty: 32,
};

export function sidebarItemHeight(item: SidebarItem): number {
  return SIDEBAR_ITEM_HEIGHT[item.kind];
}

/** Virtualize only when a single project would otherwise mount a huge list. */
export const VIRTUALIZE_AFTER = 100;

export function needsVirtualization(groups: readonly ProjectThreadGroup[]): boolean {
  return groups.some((group) => group.threads.length > VIRTUALIZE_AFTER);
}
