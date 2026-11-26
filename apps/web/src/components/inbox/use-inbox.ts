import type { DashboardThread } from '@tuffcode/contracts';
import { useEffect, useSyncExternalStore } from 'react';
import type { RpcClient } from '../../rpc/client';
import { useRpc } from '../../rpc/rpc-context';

export interface InboxState {
  threads: DashboardThread[];
  loading: boolean;
  error: string | null;
}

/**
 * One dashboard read shared by the sidebar badge and the Needs you page. It is a
 * module store rather than a hook-local state so both surfaces agree on the count
 * and only one request is in flight; the subscription starts on the first consumer
 * and stops with the last, so nothing polls while the window is closed.
 */
const EMPTY: InboxState = { threads: [], loading: false, error: null };

let state: InboxState = EMPTY;
const listeners = new Set<() => void>();
let client: RpcClient | null = null;
let consumers = 0;
let liveConsumers = 0;
let unsubscribe: (() => void) | null = null;
let inFlight = false;
let refreshQueued = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Token deltas arrive per event, so a burst coalesces into one dashboard read. */
export const INBOX_REFRESH_DEBOUNCE_MS = 250;

function publish(next: InboxState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): InboxState {
  return state;
}

/** Reads the dashboard now; a call during a read queues exactly one follow-up. */
export async function refreshInbox(): Promise<void> {
  const active = client;
  if (active === null) return;
  if (inFlight) {
    refreshQueued = true;
    return;
  }
  inFlight = true;
  publish({ ...state, loading: state.threads.length === 0 });
  try {
    const result = await active.request('threads.dashboard', {});
    publish({ threads: result.threads, loading: false, error: null });
  } catch (error) {
    publish({
      ...state,
      loading: false,
      error: error instanceof Error ? error.message : 'Could not load the Needs you list.',
    });
  } finally {
    inFlight = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refreshInbox();
    }
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshInbox();
  }, INBOX_REFRESH_DEBOUNCE_MS);
}

function start(next: RpcClient): void {
  client = next;
  unsubscribe = next.onEvent((event) => {
    if (event.type === 'thread.updated' || event.type === 'approval.requested') {
      scheduleRefresh();
      return;
    }
    // Token deltas only change how fresh a row looks, so they refresh the list only
    // while the page that shows it is open; the badge follows status frames alone.
    if (event.type === 'thread.event' && liveConsumers > 0) scheduleRefresh();
  });
  void refreshInbox();
}

function stop(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  unsubscribe?.();
  unsubscribe = null;
  client = null;
  refreshQueued = false;
  if (state.loading) publish({ ...state, loading: false });
}

export interface InboxOptions {
  /** True on the page that shows the rows: it refreshes on stream frames and on open. */
  live?: boolean;
}

export function useInbox(options: InboxOptions = {}): InboxState {
  const rpc = useRpc();
  const live = options.live ?? false;
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    consumers += 1;
    if (live) liveConsumers += 1;
    if (consumers === 1) start(rpc);
    else if (live) void refreshInbox();
    return () => {
      consumers -= 1;
      if (live) liveConsumers -= 1;
      if (consumers === 0) stop();
    };
  }, [rpc, live]);
  return current;
}
