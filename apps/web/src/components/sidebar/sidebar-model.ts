import type { Project, SubagentType, Thread } from '@tuffcode/contracts';
import { SUBAGENT_TYPES, SUBAGENT_TYPE_LABEL } from '../subagents/subagent-model';

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
 * every thread in that project; a title match keeps only the matching threads,
 * plus the root thread a matched child nests under.
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
    if (threads.length === 0) continue;

    const byId = new Map(group.threads.map((thread) => [thread.id, thread]));
    const kept = new Set(threads.map((thread) => thread.id));
    for (const thread of threads) {
      const root = rootThreadOf(thread, byId);
      if (root === null || kept.has(root.id)) continue;
      kept.add(root.id);
      threads.push(root);
    }
    threads.sort(compareThreads);
    filtered.push({ project: group.project, threads });
  }
  return filtered;
}

/** Walks parent links to the root thread, or null when the chain leaves the group. */
function rootThreadOf(thread: Thread, byId: ReadonlyMap<string, Thread>): Thread | null {
  let current = thread;
  const seen = new Set<string>();
  while (current.parentThreadId !== null) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const parent = byId.get(current.parentThreadId);
    if (parent === undefined) return null;
    current = parent;
  }
  return current;
}

/** A project row, a thread row, a nested child row, or the empty placeholder. */
export type SidebarItem =
  | { kind: 'project'; project: Project; threadCount: number; collapsed: boolean }
  | { kind: 'thread'; thread: Thread }
  | { kind: 'child'; thread: Thread; parentId: string }
  | { kind: 'empty'; projectId: string };

/**
 * The sidebar lists root threads only; a child thread renders directly under the
 * root it belongs to, so a project never shows a child at its own level.
 */
export function buildSidebarItems(
  groups: readonly ProjectThreadGroup[],
  isCollapsed: (projectId: string) => boolean,
): SidebarItem[] {
  const items: SidebarItem[] = [];
  for (const group of groups) {
    const roots = group.threads.filter((thread) => thread.parentThreadId === null);
    const childrenByParent = new Map<string, Thread[]>();
    for (const thread of group.threads) {
      if (thread.parentThreadId === null) continue;
      const siblings = childrenByParent.get(thread.parentThreadId);
      if (siblings === undefined) childrenByParent.set(thread.parentThreadId, [thread]);
      else siblings.push(thread);
    }

    const collapsed = isCollapsed(group.project.id);
    items.push({
      kind: 'project',
      project: group.project,
      threadCount: roots.length,
      collapsed,
    });
    if (collapsed) continue;

    if (roots.length === 0) {
      items.push({ kind: 'empty', projectId: group.project.id });
      continue;
    }

    for (const thread of roots) {
      items.push({ kind: 'thread', thread });
      const children = childrenByParent.get(thread.id);
      if (children === undefined) continue;
      for (const child of children.toSorted(compareChildren)) {
        items.push({ kind: 'child', thread: child, parentId: thread.id });
      }
    }
  }
  return items;
}

/** Children keep spawn order: oldest first, ties broken by id. */
function compareChildren(a: Thread, b: Thread): number {
  const byCreated = a.createdAt.localeCompare(b.createdAt);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

export function sidebarItemKey(item: SidebarItem): string {
  switch (item.kind) {
    case 'project':
      return `project:${item.project.id}`;
    case 'thread':
      return `thread:${item.thread.id}`;
    case 'child':
      return `child:${item.thread.id}`;
    case 'empty':
      return `empty:${item.projectId}`;
  }
}

/** Row heights from D38: a 48px thread row, a 44px child, 32px for the rest. */
export const SIDEBAR_ITEM_HEIGHT: Record<SidebarItem['kind'], number> = {
  project: 32,
  thread: 48,
  child: 44,
  empty: 32,
};

/** The 2px gap between sidebar rows, kept out of the measured row height. */
export const SIDEBAR_ROW_GAP = 2;

export function sidebarItemHeight(item: SidebarItem): number {
  return SIDEBAR_ITEM_HEIGHT[item.kind];
}

/** What a nested child thread is: a subagent, a council stage, or a plain child. */
export type ChildThreadKind = 'subagent' | 'council' | 'plan' | 'review' | 'thread';

const SUBAGENT_TITLE = /^Subagent\s+(\S+)/i;
const CHILD_TITLE_PREFIXES: ReadonlyArray<readonly [string, ChildThreadKind]> = [
  ['Council', 'council'],
  ['Review', 'review'],
  ['Plan', 'plan'],
];

function isSubagentType(value: string): value is SubagentType {
  return SUBAGENT_TYPES.some((type) => type === value);
}

/** The subagent type a `Subagent <type> <id>` title names, or null. */
export function childSubagentType(thread: Thread): SubagentType | null {
  const match = SUBAGENT_TITLE.exec(thread.title.trim());
  const candidate = match?.[1]?.toLowerCase();
  if (candidate === undefined || !isSubagentType(candidate)) return null;
  return candidate;
}

export function childThreadKind(thread: Thread): ChildThreadKind {
  if (childSubagentType(thread) !== null) return 'subagent';
  const title = thread.title.trim();
  for (const [prefix, kind] of CHILD_TITLE_PREFIXES) {
    if (title.startsWith(`${prefix}:`)) return kind;
  }
  return 'thread';
}

/** Council work spawns planner, reviewer and worker threads under the goal. */
export function isCouncilChild(thread: Thread): boolean {
  const kind = childThreadKind(thread);
  return kind === 'council' || kind === 'plan' || kind === 'review';
}

/**
 * A short label for a child row: the subagent type alone, "Council X" style for
 * a council stage, and the plain title otherwise.
 */
export function childThreadLabel(thread: Thread): string {
  const type = childSubagentType(thread);
  if (type !== null) return SUBAGENT_TYPE_LABEL[type];

  const title = thread.title.trim();
  for (const [prefix] of CHILD_TITLE_PREFIXES) {
    if (!title.startsWith(`${prefix}:`)) continue;
    const rest = title.slice(prefix.length + 1).trim();
    return rest === '' ? prefix : `${prefix} ${rest}`;
  }
  return title === '' ? 'Untitled thread' : title;
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
