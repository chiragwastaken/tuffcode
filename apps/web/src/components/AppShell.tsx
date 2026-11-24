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
import { ArrowLeft, PanelLeft, PanelRight, Settings } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { ConnectionStatus } from '../types';
import { InspectorPanel } from './inspector/InspectorPanel';
import { CommandPalette } from './menu/CommandPalette';
import { MenuProvider } from './menu/Menu';
import { Sidebar } from './sidebar/Sidebar';
import { ThreadActionDialogs } from './thread/thread-action-dialogs';
import { shellVisibility, windowControlsInset } from './shell-layout';

const CONNECTION_META: Record<ConnectionStatus, { dot: string; label: string }> = {
  connecting: { dot: 'bg-warning', label: 'Connecting' },
  open: { dot: 'bg-success', label: 'Connected' },
  closed: { dot: 'bg-error', label: 'Disconnected' },
  'protocol-error': { dot: 'bg-error', label: 'Protocol error' },
};

/** The inspector is a column at this width and an overlay sheet below it. */
const WIDE_LAYOUT_QUERY = '(min-width: 1280px)';

/** Everything the sheet's focus trap cycles through. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isWideLayout(): boolean {
  return typeof window === 'undefined' ? true : window.matchMedia(WIDE_LAYOUT_QUERY).matches;
}

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wide, setWide] = useState(isWideLayout);
  const [inspectorOpen, setInspectorOpen] = useState(isWideLayout);
  const sheetRef = useRef<HTMLElement>(null);
  const connection = useAppStore((state) => state.connection);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const meta = CONNECTION_META[connection];
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const visibility = shellVisibility(pathname);
  const threadMatch = matchRoute({ to: '/project/$projectId/thread/$threadId' });
  const inspectorThreadId = threadMatch === false ? null : threadMatch.threadId;
  const hasThread = inspectorThreadId !== null;
  const showInspectorToggle = visibility.inspector && hasThread;
  const inspectorVisible = showInspectorToggle && inspectorOpen;
  /** Below xl the inspector is an overlay sheet, which behaves as a modal dialog. */
  const sheetOpen = inspectorVisible && !wide;

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
      setWide(event.matches);
      // Wide shows the column, narrow closes the sheet so it never covers the
      // thread uninvited.
      setInspectorOpen(event.matches);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  // The narrow sheet is a modal: it traps Tab, closes on Escape, and returns focus
  // to whatever opened it. The page behind it is inert while it is open.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheetOpen || sheet === null) return;

    const previouslyFocused = document.activeElement;
    const focusable = (): HTMLElement[] =>
      [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.offsetParent !== null,
      );

    (focusable()[0] ?? sheet).focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || (event.key !== 'Escape' && event.key !== 'Tab')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setInspectorOpen(false);
        return;
      }

      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        sheet?.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      const outside = active === null || !sheet?.contains(active);

      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [sheetOpen]);

  return (
    <MenuProvider>
      <div
        data-testid="app-shell"
        className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      >
        <header
          inert={sheetOpen}
          className="drag-region flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border pl-2"
          style={{ paddingRight: 'calc(var(--window-controls-inset, 0px) + 1.5rem)' }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {visibility.backToWorkspace ? (
              <Link
                to="/"
                aria-label="Back to workspace"
                title="Back to workspace"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                  'no-drag shrink-0',
                )}
              >
                <ArrowLeft strokeWidth={1.75} />
              </Link>
            ) : (
              <IconButton
                icon={PanelLeft}
                label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                size="sm"
                aria-pressed={sidebarOpen}
                className="no-drag shrink-0"
                onClick={() => setSidebarOpen((open) => !open)}
              />
            )}

            <span className="shrink-0 text-sm font-semibold tracking-tight">Tuffcode</span>

            {visibility.backToWorkspace ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">Settings</span>
            ) : null}
          </div>

          <div className="no-drag flex shrink-0 items-center gap-1">
            {showInspectorToggle ? (
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
              inert={sheetOpen}
              className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
            >
              <Sidebar />
            </aside>
          ) : null}

          <main inert={sheetOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>

          {hasThread ? (
            <>
              {inspectorVisible ? (
                <button
                  type="button"
                  aria-label="Close inspector"
                  data-testid="inspector-backdrop"
                  className="fixed inset-0 z-30 bg-black/40 xl:hidden"
                  onClick={() => setInspectorOpen(false)}
                />
              ) : null}
              <aside
                ref={sheetRef}
                aria-label="Inspector"
                role={sheetOpen ? 'dialog' : undefined}
                aria-modal={sheetOpen ? true : undefined}
                tabIndex={-1}
                data-panel=""
                data-slot="right-panel"
                data-state={inspectorVisible ? 'open' : 'closed'}
                className={cn(
                  'z-40 min-h-0 flex-col border-border bg-background outline-none',
                  // Below the topbar: its top-right corner is reserved for the native
                  // caption buttons, so the sheet's own header and collapse control
                  // must stay under it. The backdrop still covers the whole window.
                  'max-xl:fixed max-xl:top-[var(--topbar-height)] max-xl:right-0 max-xl:bottom-0',
                  'max-xl:w-[min(26rem,92vw)] max-xl:border-l max-xl:shadow-2xl',
                  'xl:static xl:w-[var(--right-panel-width)] xl:max-w-[var(--right-panel-max-width)] xl:shrink-0 xl:border-l',
                  // Kept mounted while hidden so the terminal and tab choice survive.
                  inspectorVisible ? 'flex' : 'hidden',
                )}
              >
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <InspectorPanel
                    threadId={inspectorThreadId}
                    onCollapse={() => setInspectorOpen(false)}
                  />
                </div>
              </aside>
            </>
          ) : null}
        </div>
      </div>
      <CommandPalette />
      <ThreadActionDialogs />
    </MenuProvider>
  );
}
