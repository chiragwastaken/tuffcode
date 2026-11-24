import { Link, Outlet } from '@tanstack/react-router';
import { IconButton, buttonVariants, cn } from '@tuffcode/ui';
import { PanelLeft, Settings } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { ConnectionStatus } from '../types';
import { Sidebar } from './sidebar/Sidebar';

const CONNECTION_META: Record<ConnectionStatus, { dot: string; label: string }> = {
  connecting: { dot: 'bg-warning', label: 'Connecting' },
  open: { dot: 'bg-success', label: 'Connected' },
  closed: { dot: 'bg-error', label: 'Disconnected' },
  'protocol-error': { dot: 'bg-error', label: 'Protocol error' },
};

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const connection = useAppStore((state) => state.connection);
  const version = useAppStore((state) => state.bootstrap?.version);
  const meta = CONNECTION_META[connection];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="drag-region flex h-[var(--topbar-height)] shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="no-drag flex items-center gap-1">
          <IconButton
            icon={PanelLeft}
            label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            size="sm"
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          />
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">Tuffcode</span>
          {version ? (
            <span className="text-2xs tabular-nums text-muted-foreground">v{version}</span>
          ) : null}
        </div>
        <div className="no-drag ml-auto flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-2xs text-muted-foreground"
            title={meta.label}
          >
            <span
              role="img"
              aria-label={meta.label}
              className={cn('size-2 rounded-full', meta.dot)}
            />
            <span className="hidden sm:inline">{meta.label}</span>
          </span>
          <Link
            to="/settings/{-$section}"
            params={{}}
            aria-label="Settings"
            title="Settings"
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <Settings strokeWidth={1.75} />
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
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

        <aside
          aria-label="Inspector"
          data-slot="right-panel"
          className="hidden w-[var(--right-panel-width)] max-w-[var(--right-panel-max-width)] shrink-0 border-l border-border xl:block"
        />
      </div>
    </div>
  );
}
