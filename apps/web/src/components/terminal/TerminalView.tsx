import { Terminal, cn, type TerminalHandle } from '@tuffcode/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RpcClient } from '../../rpc/client';
import { subscribeTerminalData } from './terminal-data';
import { TerminalError, terminalErrorMessage } from './TerminalError';
import { TERMINAL_FONT_SIZE } from './terminal-size';

/** Coalesce the resize storm a window drag produces into one RPC call. */
export const RESIZE_DEBOUNCE_MS = 150;

export interface TerminalViewProps {
  terminalId: string;
  rpc: RpcClient;
  active: boolean;
  /** Replace a terminal whose pty stopped answering. */
  onReopen: (terminalId: string) => void;
}

export function TerminalView({ terminalId, rpc, active, onReopen }: TerminalViewProps) {
  const handleRef = useRef<TerminalHandle | null>(null);
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeTerminalData(rpc, terminalId, (data) => handleRef.current?.write(data));
  }, [rpc, terminalId]);

  // A hidden tab measures zero, so refit and focus once it becomes visible.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      handleRef.current?.fit();
      handleRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    return () => {
      clearTimeout(resizeTimerRef.current);
    };
  }, []);

  const sendInput = useCallback(
    (data: string) => {
      void rpc.request('terminal.input', { terminalId, data }).catch((cause: unknown) => {
        setError(terminalErrorMessage(cause));
      });
    },
    [rpc, terminalId],
  );

  const sendResize = useCallback(
    (size: { cols: number; rows: number }) => {
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = undefined;
        void rpc
          .request('terminal.resize', { terminalId, cols: size.cols, rows: size.rows })
          .catch((cause: unknown) => {
            setError(terminalErrorMessage(cause));
          });
      }, RESIZE_DEBOUNCE_MS);
    },
    [rpc, terminalId],
  );

  const retry = useCallback(() => {
    setError(null);
    onReopen(terminalId);
  }, [onReopen, terminalId]);

  return (
    <div
      hidden={!active}
      role="tabpanel"
      id={`terminal-panel-${terminalId}`}
      aria-labelledby={`terminal-tab-${terminalId}`}
      data-terminal-id={terminalId}
      className="absolute inset-0 focus-within:ring-2 focus-within:ring-ring focus-within:ring-inset"
    >
      <Terminal
        ref={handleRef}
        autoFocus={active}
        fontSize={TERMINAL_FONT_SIZE}
        onData={sendInput}
        onResize={sendResize}
        className={cn('p-1.5')}
      />
      {error ? (
        <div className="absolute inset-x-3 top-3">
          <TerminalError message={error} onRetry={retry} />
        </div>
      ) : null}
    </div>
  );
}
