import type { ServerEvent, ThreadEventRow } from '@tuffcode/contracts';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { setApprovalDecision } from './local-messages';
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

  useEffect(() => {
    const sinceSeq = useAppStore.getState().events[threadId]?.at(-1)?.seq ?? 0;
    let disposed = false;
    let replayed = false;
    const buffered: ThreadEventRow[] = [];

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
  }, [appendEvent, rpc, threadId]);
}
