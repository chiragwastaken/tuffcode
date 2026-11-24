import { Button, EmptyState, IconButton, Spinner, cn, focusRing } from '@tuffcode/ui';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { TerminalError, terminalErrorMessage } from './TerminalError';
import { TerminalView } from './TerminalView';
import { TERMINAL_FONT_SIZE, measureTerminalSize } from './terminal-size';
import {
  subscribeTerminalRequests,
  takeTerminalRequest,
  terminalCdCommand,
} from './terminal-requests';
import { initialTerminalTabs, terminalTabsReducer } from './terminal-tabs';

export interface TerminalPanelProps {
  threadId: string;
  className?: string;
}

type OpenState = { status: 'idle' } | { status: 'opening' } | { status: 'error'; error: string };

const IDLE: OpenState = { status: 'idle' };

function terminalTabTitle(index: number): string {
  return `Terminal ${index + 1}`;
}

export function TerminalPanel({ threadId, className }: TerminalPanelProps) {
  const rpc = useRpc();
  const [tabs, dispatch] = useReducer(terminalTabsReducer, initialTerminalTabs);
  const [openState, setOpenState] = useState<OpenState>(IDLE);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const ownedRef = useRef<Set<string>>(new Set<string>());
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const spawningRef = useRef(false);
  const pendingCdRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sendCd = useCallback(
    (terminalId: string, path: string): void => {
      void rpc
        .request('terminal.input', { terminalId, data: terminalCdCommand(path) })
        .catch((cause: unknown) => toast.error(terminalErrorMessage(cause)));
    },
    [rpc],
  );

  const spawn = useCallback(async (): Promise<void> => {
    if (spawningRef.current) return;
    spawningRef.current = true;
    const generation = generationRef.current;
    setOpenState({ status: 'opening' });
    const size = measureTerminalSize(bodyRef.current, TERMINAL_FONT_SIZE);
    let openedId: string | null = null;

    try {
      const { terminalId } = await rpc.request('terminal.open', {
        threadId,
        cols: size.cols,
        rows: size.rows,
      });
      const cdPath = pendingCdRef.current;
      pendingCdRef.current = null;

      // A newer spawn (or unmount) owns the panel now; never leak the pty.
      if (!mountedRef.current || generation !== generationRef.current) {
        void rpc.request('terminal.close', { terminalId }).catch(() => {});
        return;
      }

      ownedRef.current.add(terminalId);
      openedId = terminalId;
      dispatch({ type: 'open', terminalId });
      setOpenState(IDLE);
      if (cdPath !== null) sendCd(terminalId, cdPath);
    } catch (cause) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setOpenState({ status: 'error', error: terminalErrorMessage(cause) });
    } finally {
      spawningRef.current = false;
      const pending = pendingCdRef.current;
      if (pending !== null && openedId !== null) {
        pendingCdRef.current = null;
        sendCd(openedId, pending);
      }
    }
  }, [rpc, sendCd, threadId]);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = tabs.activeId;

  // A diff file asked for a terminal at its directory: reuse the open pty or
  // open one, then cd before the user types anything.
  useEffect(() => {
    function handleRequest(): void {
      const path = takeTerminalRequest();
      if (path === null) return;
      const activeId = activeIdRef.current;
      if (activeId !== null) {
        sendCd(activeId, path);
        return;
      }
      pendingCdRef.current = path;
      void spawn();
    }

    const unsubscribe = subscribeTerminalRequests(handleRequest);
    handleRequest();
    return unsubscribe;
  }, [sendCd, spawn]);

  // One terminal per thread: reset the strip and close every pty on change or unmount.
  useEffect(() => {
    generationRef.current += 1;
    const owned = ownedRef.current;
    dispatch({ type: 'reset' });
    void spawn();

    return () => {
      generationRef.current += 1;
      for (const terminalId of owned) {
        void rpc.request('terminal.close', { terminalId }).catch(() => {});
      }
      owned.clear();
    };
  }, [rpc, spawn]);

  const closeTerminal = useCallback(
    (terminalId: string) => {
      ownedRef.current.delete(terminalId);
      dispatch({ type: 'close', terminalId });
      void rpc.request('terminal.close', { terminalId }).catch(() => {});
    },
    [rpc],
  );

  const reopenTerminal = useCallback(
    (terminalId: string) => {
      ownedRef.current.delete(terminalId);
      dispatch({ type: 'close', terminalId });
      void rpc.request('terminal.close', { terminalId }).catch(() => {});
      void spawn();
    },
    [rpc, spawn],
  );

  const activeId = tabs.activeId;
  const opening = openState.status === 'opening';

  return (
    <section
      aria-label="Terminal"
      data-testid="terminal-panel"
      className={cn(
        'flex h-full min-h-0 flex-col bg-terminal-background text-foreground',
        className,
      )}
    >
      <div className="flex h-[var(--row-height)] shrink-0 items-center gap-1 border-b border-border px-2">
        <div
          role="group"
          aria-label="Terminals"
          className="flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {tabs.tabs.map((tab, index) => {
            const title = terminalTabTitle(index);
            const selected = tab.terminalId === activeId;
            return (
              <div
                key={tab.terminalId}
                className={cn(
                  'flex h-7 shrink-0 items-center rounded-sm',
                  selected
                    ? 'bg-surface-raised text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  title={title}
                  className={cn(
                    'h-full max-w-40 truncate rounded-sm pl-2.5 pr-1 text-xs font-medium',
                    focusRing,
                  )}
                  onClick={() => dispatch({ type: 'activate', terminalId: tab.terminalId })}
                >
                  {title}
                </button>
                <IconButton
                  icon={X}
                  label={`Close ${title}`}
                  size="sm"
                  className="size-6 rounded-l-none [&_svg]:size-3"
                  onClick={() => closeTerminal(tab.terminalId)}
                />
              </div>
            );
          })}
        </div>

        <IconButton
          icon={Plus}
          label="New terminal"
          size="sm"
          disabled={opening}
          onClick={() => void spawn()}
        />
        {opening && tabs.tabs.length > 0 ? <Spinner size="sm" label="Opening terminal" /> : null}
      </div>

      {openState.status === 'error' ? (
        <div className="shrink-0 border-b border-border p-2">
          <TerminalError message={openState.error} onRetry={() => void spawn()} />
        </div>
      ) : null}

      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.tabs.map((tab) => (
          <TerminalView
            key={tab.terminalId}
            terminalId={tab.terminalId}
            rpc={rpc}
            active={tab.terminalId === activeId}
            onReopen={reopenTerminal}
          />
        ))}

        {tabs.tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3">
            {opening ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner size="sm" label="Opening terminal" />
                Starting terminal
              </span>
            ) : (
              <EmptyState
                variant="inline"
                title="No terminal open."
                action={
                  <Button size="sm" variant="outline" onClick={() => void spawn()}>
                    New terminal
                  </Button>
                }
                className="w-full"
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
