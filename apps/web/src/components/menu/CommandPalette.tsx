import { useNavigate } from '@tanstack/react-router';
import { Kbd, cn, focusRing } from '@tuffcode/ui';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/app-store';
import {
  ACTIONS,
  PALETTE_ACTIONS,
  actionUnavailableReason,
  runAction,
  type ActionContext,
  type ActionId,
} from '../actions';
import { requestThreadDelete, requestThreadRename } from '../thread/thread-dialogs';
import { useActionPorts } from './action-context';
import { matchesMenuQuery, stepEnabledIndex } from './menu-model';

/**
 * Ctrl/Cmd+K palette. It lists the same registry entries the context menus use,
 * so a new action only has to be added once.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ports = useActionPorts();
  const navigate = useNavigate();
  const thread = useAppStore((state) =>
    state.activeThreadId === null ? undefined : state.threads[state.activeThreadId],
  );

  const context = useMemo<ActionContext>(
    () => ({
      ...ports,
      thread,
      threadId: thread?.id,
      ui: {
        openThread: (target) => {
          void navigate({
            to: '/project/$projectId/thread/$threadId',
            params: { projectId: target.projectId, threadId: target.id },
          });
        },
        renameThread: requestThreadRename,
        deleteThread: requestThreadDelete,
      },
    }),
    [navigate, ports, thread],
  );

  const entries = useMemo(
    () =>
      PALETTE_ACTIONS.map((id) => ACTIONS[id]).filter(
        (action) =>
          matchesMenuQuery(action.label, query) &&
          actionUnavailableReason(action.id, context) === null,
      ),
    [context, query],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpen((value) => !value);
      setQuery('');
      setActiveIndex(0);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(entries.length === 0 ? -1 : 0);
  }, [entries.length, open]);

  function close(): void {
    setOpen(false);
    setQuery('');
  }

  function activate(id: ActionId): void {
    close();
    void Promise.resolve(runAction(id, context)).catch((error: unknown) => {
      context.notify.error(error instanceof Error ? error.message : 'That action failed.');
    });
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const disabled = entries.map(() => false);
      const next = stepEnabledIndex(disabled, activeIndex, event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[activeIndex];
      if (entry !== undefined) activate(entry.id);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 pt-24"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="flex w-[min(28rem,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="relative border-b border-border">
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            aria-label="Search actions"
            placeholder="Search actions"
            spellCheck={false}
            className={cn(
              'h-10 w-full bg-transparent pr-16 pl-9 text-sm text-foreground outline-none',
              'placeholder:text-muted-foreground',
            )}
          />
          <Kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">Esc</Kbd>
        </div>

        {entries.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {thread === undefined
              ? 'Open a thread to use its actions.'
              : 'No actions match that search.'}
          </p>
        ) : (
          <ul role="menu" aria-label="Actions" className="p-1">
            {entries.map((action, index) => {
              const Icon = action.icon;
              const active = index === activeIndex;
              return (
                <li key={action.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    data-action={action.id}
                    data-active={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activate(action.id)}
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px]',
                      focusRing,
                      action.destructive
                        ? 'text-error-foreground data-[active=true]:bg-error-surface'
                        : 'text-foreground data-[active=true]:bg-accent',
                    )}
                  >
                    <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.shortcut === undefined ? null : (
                      <Kbd className="h-4 min-w-0 border-0 bg-transparent px-0 text-2xs text-muted-foreground">
                        {action.shortcut}
                      </Kbd>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            Run
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
