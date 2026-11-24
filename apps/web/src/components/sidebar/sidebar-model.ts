import type { Project, Thread } from '@tuffcode/contracts';

/** A project plus the threads that belong to it, newest first. */
export interface ProjectThreadGroup {
  project: Project;
  threads: Thread[];
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
  project: 30,
  thread: 34,
  empty: 30,
};

export function sidebarItemHeight(item: SidebarItem): number {
  return SIDEBAR_ITEM_HEIGHT[item.kind];
}

/** Virtualize once the grouped thread list would mount more than 100 rows. */
export const VIRTUALIZE_AFTER = 100;

export function needsVirtualization(groups: readonly ProjectThreadGroup[]): boolean {
  let rows = 0;
  for (const group of groups) {
    rows += group.threads.length;
    if (rows > VIRTUALIZE_AFTER) return true;
  }
  return false;
}

/** Storage key for the projects whose threads are collapsed in the sidebar. */
export const SIDEBAR_COLLAPSED_KEY = 'tuffcode.sidebar.collapsed-projects';

/** The slice of `Storage` the sidebar needs; tests pass a plain map. */
export type CollapseStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads the remembered collapsed project ids; defaults to none collapsed. */
export function readCollapsedProjects(storage: CollapseStore | null): ReadonlySet<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

/** Remembers collapsed projects for the next launch. */
export function writeCollapsedProjects(
  storage: CollapseStore | null,
  collapsed: ReadonlySet<string>,
): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A disabled or full storage just forgets the preference.
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A compact relative timestamp for a thread row: "now", "5m", "3h", "2d", then
 * the calendar date once it is older than a week. Invalid input renders empty.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;

  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
