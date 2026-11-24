import type { Project, Thread } from '@tuffcode/contracts';

/** Width reserved for the native caption buttons (Windows 11 x64 titleBarOverlay). */
export const WINDOW_CONTROLS_INSET_WIN32 = 140;

/** Right inset the header must keep free of controls for the platform's window chrome. */
export function windowControlsInset(platform: string | null | undefined): number {
  return platform === 'win32' ? WINDOW_CONTROLS_INSET_WIN32 : 0;
}

export type RootView =
  | { kind: 'empty-workspace' }
  | { kind: 'redirect'; projectId: string; threadId: string }
  | { kind: 'no-threads' };

export interface RootViewInput {
  projects: Project[];
  threads: Record<string, Thread>;
  activeThreadId: string | null;
}

/**
 * Decides what `/` shows: the workspace empty state when there is no project, the
 * last opened (or most recently updated) thread when one exists, and a no-threads
 * hint in between. Threads whose project was removed are ignored.
 */
export function resolveRootView({ projects, threads, activeThreadId }: RootViewInput): RootView {
  if (projects.length === 0) return { kind: 'empty-workspace' };

  const projectIds = new Set(projects.map((project) => project.id));
  const active = activeThreadId === null ? undefined : threads[activeThreadId];
  const candidate =
    active !== undefined && projectIds.has(active.projectId)
      ? active
      : Object.values(threads)
          .filter((thread) => projectIds.has(thread.projectId))
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (candidate === undefined) return { kind: 'no-threads' };

  return { kind: 'redirect', projectId: candidate.projectId, threadId: candidate.id };
}

export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

export interface ShellVisibility {
  /** Thread sidebar column. */
  sidebar: boolean;
  /** Inspector column or sheet. */
  inspector: boolean;
  /** Slim back-to-workspace control in place of the sidebar toggle. */
  backToWorkspace: boolean;
}

/**
 * Settings owns the whole window: the thread sidebar and the inspector would both
 * compete with the 240px section nav, so they are hidden and the header keeps a
 * single back-to-workspace control.
 */
export function shellVisibility(pathname: string): ShellVisibility {
  const settings = isSettingsPath(pathname);
  return { sidebar: !settings, inspector: !settings, backToWorkspace: settings };
}
