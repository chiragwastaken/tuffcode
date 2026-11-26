import type { ServerEvent, ThreadEventRow } from '@tuffcode/contracts';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import type { ConnectionStatus } from '../../types';
import { persistedTurnIds } from './grouping';
import { pruneResolvedLocalUserMessages, setApprovalDecision } from './local-messages';
import { createStreamBatcher } from './stream-batcher';

type ThreadEventFrame = Extract<ServerEvent, { type: 'thread.event' }>;

function toRow(event: ThreadEventFrame): ThreadEventRow {
  return {
    // Live frames carry no database row id; the per-thread seq is the cursor.
    id: event.seq + 1,
    threadId: event.threadId,
    seq: event.seq,
    type: event.payload.type,
    payload: event.payload,
    // The server stamps the row once, so a live frame and its replayed row agree.
    createdAt: event.createdAt,
  };
}

/** The slice of the RPC client the replay controller reads. */
export interface ConnectionSource {
  getStatus(): ConnectionStatus;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
}

export interface ThreadReplayOptions {
  connection: ConnectionSource;
  /** Drains every `threads.events` page from a cursor into the store. */
  replay: (sinceSeq: number) => Promise<{ hasMore: boolean }>;
  /** The newest stored seq, read at call time so a reconnect drains from there. */
  lastSeq: () => number;
  /** Releases live frames buffered while the first replay was in flight. */
  onInitialReplay: () => void;
  onInitialError: (error: unknown) => void;
  logger?: Pick<Console, 'warn'>;
}

export interface ThreadReplayController {
  /** Starts the first replay once; later calls are ignored. */
  start(sinceSeq: number): void;
  dispose(): void;
}

/**
 * Runs the first replay and every reconnect replay one at a time. A socket that
 * reopens after a drop drains whatever the store missed while offline, so a
 * `turn.finished` broadcast during the gap is not lost and a spinner cannot hang.
 */
export function createThreadReplayController({
  connection,
  replay,
  lastSeq,
  onInitialReplay,
  onInitialError,
  logger = console,
}: ThreadReplayOptions): ThreadReplayController {
  let started = false;
  let settled = false;
  let running = false;
  let queued = false;
  let disposed = false;
  let previousStatus = connection.getStatus();

  async function run(cursor: number, initial: boolean): Promise<void> {
    running = true;
    try {
      await replay(cursor);
      if (disposed) return;
      if (initial) {
        settled = true;
        onInitialReplay();
      }
    } catch (error) {
      if (disposed) return;
      if (initial) {
        settled = true;
        onInitialReplay();
        onInitialError(error);
      } else {
        // A reconnect replay is best effort: the next open retries from the store.
        logger.warn('[thread] Could not replay events after a reconnect.', error);
      }
    } finally {
      running = false;
      if (queued && !disposed) {
        queued = false;
        void run(lastSeq(), false);
      }
    }
  }

  const unsubscribe = connection.onStatus((status) => {
    const wasOpen = previousStatus === 'open';
    previousStatus = status;
    if (disposed || status !== 'open' || wasOpen) return;
    // The first replay owns the drain until it settles; live frames stay buffered.
    if (!settled) return;
    if (running) {
      queued = true;
      return;
    }
    void run(lastSeq(), false);
  });

  return {
    start(sinceSeq) {
      if (started || disposed) return;
      started = true;
      void run(sinceSeq, true);
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

/**
 * Loads replay history once per thread, then funnels live `thread.event` frames
 * through a 50 ms rAF batcher so a streaming turn cannot re-render per token.
 * Live frames that beat the replay response are buffered; the store drops any
 * row at or below its last seq, so appending them early would lose history.
 */
export function useThreadStream(threadId: string): void {
  const rpc = useRpc();
  const appendEvent = useAppStore((state) => state.appendEvent);
  const setMessages = useAppStore((state) => state.setMessages);

  useEffect(() => {
    const sinceSeq = useAppStore.getState().events[threadId]?.at(-1)?.seq ?? 0;
    let disposed = false;
    let replayed = false;
    let messagesToken = 0;
    const buffered: ThreadEventRow[] = [];

    function loadMessages(notify: boolean): void {
      messagesToken += 1;
      const token = messagesToken;
      void rpc.request('messages.list', { threadId }).then(
        (rows) => {
          if (disposed || token !== messagesToken) return;
          setMessages(threadId, rows);
          pruneResolvedLocalUserMessages(threadId, persistedTurnIds(rows));
        },
        (error: unknown) => {
          if (disposed || token !== messagesToken) return;
          if (notify) {
            toast.error(error instanceof Error ? error.message : 'Could not load thread messages.');
            return;
          }
          // A superseded load may have been discarded; recover when nothing landed.
          const loaded = useAppStore.getState().messages[threadId]?.length ?? 0;
          if (loaded === 0) loadMessages(true);
        },
      );
    }

    // Persisted rows carry the user turns and any assistant text the event replay
    // cannot reconstruct, so a reopened thread reads the same as a live one.
    loadMessages(true);

    const batcher = createStreamBatcher({
      flush: (events) => {
        for (const event of events) appendEvent(threadId, event);
      },
    });

    function release(): void {
      replayed = true;
      for (const row of buffered) batcher.push(row);
      buffered.length = 0;
    }

    const unsubscribe = rpc.onEvent((event) => {
      if (event.type === 'thread.event') {
        if (event.threadId !== threadId) return;
        const row = toRow(event);
        if (replayed) batcher.push(row);
        else buffered.push(row);
        // The server persists the assistant row before it broadcasts turn.finished.
        if (event.payload.type === 'turn.finished') loadMessages(false);
        return;
      }
      if (event.type === 'approval.requested' && event.payload.threadId === threadId) {
        if (event.payload.decision !== 'pending') {
          setApprovalDecision(event.payload.id, event.payload.decision);
        }
      }
    });

    const replayController = createThreadReplayController({
      connection: rpc,
      replay: (cursor) => rpc.replay(threadId, cursor),
      lastSeq: () => useAppStore.getState().events[threadId]?.at(-1)?.seq ?? 0,
      onInitialReplay: release,
      onInitialError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Could not load thread history.');
      },
    });
    replayController.start(sinceSeq);

    return () => {
      disposed = true;
      replayController.dispose();
      unsubscribe();
      batcher.dispose();
    };
  }, [appendEvent, rpc, setMessages, threadId]);
}
