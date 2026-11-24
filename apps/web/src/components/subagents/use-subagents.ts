import { useEffect, useState } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { isTerminalSubagentStatus, useAppStore, type SubagentChild } from '../../store/app-store';

/** The list refresh debounce: a spawn and its settle frame arrive close together. */
const LIST_REFRESH_MS = 250;

/**
 * Loads the persisted child rows for a thread and refreshes them when a child
 * spawns or settles. Live frames only carry type, model and status, so the task and
 * summary come from this list; merging never clobbers a settled live status.
 */
export function useSubagentList(threadId: string): void {
  const rpc = useRpc();

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = (): void => {
      void rpc.request('subagents.list', { threadId }).then(
        (views) => {
          if (!disposed) useAppStore.getState().mergeSubagentViews(threadId, views);
        },
        // A failed list leaves the live frames on screen; the next frame retries.
        () => undefined,
      );
    };

    load();

    const unsubscribe = rpc.onEvent((event) => {
      if (event.type !== 'subagent.started' && event.type !== 'subagent.finished') return;
      if (event.payload.threadId !== threadId) return;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed) load();
      }, LIST_REFRESH_MS);
    });

    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [rpc, threadId]);
}

/**
 * A one-second clock that runs only while a child is unsettled, so elapsed labels
 * advance without a timer per card.
 */
export function useSubagentClock(children: readonly SubagentChild[]): number {
  const running = children.some((child) => !isTerminalSubagentStatus(child.status));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return now;
}
