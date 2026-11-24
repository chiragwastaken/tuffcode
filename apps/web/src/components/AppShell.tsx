import { Link, Outlet, useMatchRoute, useRouterState } from '@tanstack/react-router';
import {
  Button,
  IconButton,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  buttonVariants,
  cn,
} from '@tuffcode/ui';
import { ArrowLeft, PanelLeft, PanelRight, Settings, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { ConnectionStatus } from '../types';
import { InspectorPanel } from './inspector/InspectorPanel';
import { Sidebar } from './sidebar/Sidebar';
import { shellVisibility, windowControlsInset } from './shell-layout';

const CONNECTION_META: Record<ConnectionStatus, { dot: string; label: string }> = {
  connecting: { dot: 'bg-warning', label: 'Connecting' },
  open: { dot: 'bg-success', label: 'Connected' },
  closed: { dot: 'bg-error', label: 'Disconnected' },
  'protocol-error': { dot: 'bg-error', label: 'Protocol error' },
};

/** The inspector is a column at this width and an overlay sheet below it. */
const WIDE_LAYOUT_QUERY = '(min-width: 1280px)';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(WIDE_LAYOUT_QUERY).matches,
  );
  const connection = useAppStore((state) => state.connection);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const projects = useAppStore((state) => state.projects);
  const threads = useAppStore((state) => state.threads);
  const meta = CONNECTION_META[connection];
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const visibility = shellVisibility(pathname);
  const threadMatch = matchRoute({ to: '/project/$projectId/thread/$threadId' });
  const inspectorThreadId = threadMatch === false ? null : threadMatch.threadId;
  const thread = inspectorThreadId === null ? undefined : threads[inspectorThreadId];
  const projectName =
    thread === undefined
      ? undefined
      : projects.find((project) => project.id === thread.projectId)?.name;
  const showInspector = visibility.inspector && inspectorThreadId !== null;

  useLayoutEffect(() => {
    const element = document.documentElement;
    const applyPlatform = (platform: string | undefined): void => {
      if (!platform) return;
      element.dataset.platform = platform;
      element.style.setProperty('--window-controls-inset', `${windowControlsInset(platform)}px`);
    };

    if (bootstrap?.platform) {
      applyPlatform(bootstrap.platform);
      return;
    }

    let cancelled = false;
    void window.tuffcode
      ?.getBootstrap()
      .then((info) => {
        if (!cancelled) applyPlatform(info.platform);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bootstrap?.platform]);

  useEffect(() => {
    const query = window.matchMedia(WIDE_LAYOUT_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => {
      if (event.matches) setInspectorOpen(true);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <header
        className="drag-region flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border pl-2"
        style={{ paddingRight: 'calc(var(--window-controls-inset, 0px) + 1.5rem)' }}
      >
        <div className="no-drag flex min-w-0 flex-1 items-center gap-2">
          {visibility.backToWorkspace ? (
            <Link
              to="/"
              aria-label="Back to workspace"
              title="Back to workspace"
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0')}
            >
              <ArrowLeft strokeWidth={1.75} />
            </Link>
          ) : (
            <IconButton
              icon={PanelLeft}
              label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              size="sm"
              aria-pressed={sidebarOpen}
              className="shrink-0"
              onClick={() => setSidebarOpen((open) => !open)}
            />
          )}

          <span className="shrink-0 text-sm font-semibold tracking-tight">Tuffcode</span>

          {visibility.backToWorkspace ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">Settings</span>
          ) : thread !== undefined ? (
            <nav
              aria-label="Breadcrumb"
              data-testid="header-breadcrumb"
              className="flex min-w-0 items-center gap-1.5 text-xs"
            >
              <span
                className="min-w-0 max-w-40 truncate text-muted-foreground"
                title={projectName ?? thread.projectId}
              >
                {projectName ?? thread.projectId}
              </span>
              <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
                /
              </span>
              <span className="min-w-0 truncate text-foreground" title={thread.title}>
                {thread.title}
              </span>
            </nav>
          ) : null}
        </div>

        <div className="no-drag flex shrink-0 items-center gap-1">
          {showInspector ? (
            <IconButton
              icon={PanelRight}
              label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
              size="sm"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            />
          ) : null}

          <PopoverRoot>
            <PopoverTrigger
              data-testid="connection-status"
              data-status={connection}
              title={meta.label}
              aria-label={`Connection: ${meta.label}`}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'gap-1.5 px-2 text-2xs',
              )}
            >
              <span aria-hidden="true" className={cn('size-2 rounded-full', meta.dot)} />
              <span className="hidden sm:inline">{meta.label}</span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <div className="flex flex-col gap-2" data-testid="connection-popover">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xs text-muted-foreground">Status</span>
                  <span className="flex items-center gap-1.5 text-xs text-foreground">
                    <span aria-hidden="true" className={cn('size-2 rounded-full', meta.dot)} />
                    {meta.label}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xs text-muted-foreground">Port</span>
                  <span
                    className="text-xs tabular-nums text-foreground"
                    data-testid="connection-port"
                  >
                    {bootstrap?.port ?? 'unknown'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xs text-muted-foreground">Version</span>
                  <span
                    className="text-xs tabular-nums text-foreground"
                    data-testid="connection-version"
                  >
                    {bootstrap?.version ?? 'unknown'}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 w-full"
                  data-testid="connection-reconnect"
                  onClick={() => window.location.reload()}
                >
                  Reconnect
                </Button>
              </div>
            </PopoverContent>
          </PopoverRoot>

          {visibility.backToWorkspace ? null : (
            <Link
              to="/settings/{-$section}"
              params={{}}
              aria-label="Settings"
              title="Settings"
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            >
              <Settings strokeWidth={1.75} />
            </Link>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {visibility.sidebar && sidebarOpen ? (
          <aside
            aria-label="Projects and threads"
            className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          >
            <Sidebar />
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>

        {showInspector && inspectorOpen ? (
          <>
            <button
              type="button"
              aria-label="Close inspector"
              data-testid="inspector-backdrop"
              className="fixed inset-x-0 bottom-0 top-[var(--topbar-height)] z-30 bg-black/40 xl:hidden"
              onClick={() => setInspectorOpen(false)}
            />
            <aside
              aria-label="Inspector"
              data-slot="right-panel"
              className={cn(
                'z-40 flex min-h-0 flex-col border-border bg-background',
                'max-xl:fixed max-xl:top-[var(--topbar-height)] max-xl:right-0 max-xl:bottom-0',
                'max-xl:w-[min(26rem,92vw)] max-xl:border-l max-xl:shadow-2xl',
                'xl:static xl:w-[var(--right-panel-width)] xl:max-w-[var(--right-panel-max-width)] xl:shrink-0 xl:border-l',
              )}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 xl:hidden">
                <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Inspector
                </span>
                <IconButton
                  icon={X}
                  label="Close inspector"
                  size="sm"
                  onClick={() => setInspectorOpen(false)}
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <InspectorPanel threadId={inspectorThreadId} />
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
