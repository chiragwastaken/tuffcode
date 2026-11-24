import type { ServerEvent, ThreadEventRow } from '@tuffcode/contracts';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
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
    createdAt: new Date().toISOString(),
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

    void rpc.replay(threadId, sinceSeq).then(
      () => {
        if (!disposed) release();
      },
      (error: unknown) => {
        if (disposed) return;
        release();
        toast.error(error instanceof Error ? error.message : 'Could not load thread history.');
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
      batcher.dispose();
    };
  }, [appendEvent, rpc, setMessages, threadId]);
}
