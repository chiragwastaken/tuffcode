import type { ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_EVENTS_PER_THREAD, createAppStore } from './app-store';

function textEvent(seq: number, threadId = 'thread-1'): ThreadEventRow {
  return {
    id: seq + 1,
    threadId,
    seq,
    type: 'text.delta',
    payload: { type: 'text.delta', turnId: 'turn-1', text: `chunk ${seq}` },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function seqs(store: ReturnType<typeof createAppStore>, threadId = 'thread-1'): number[] {
  return (store.getState().events[threadId] ?? []).map((event) => event.seq);
}

describe('app store appendEvent', () => {
  it('keeps events ordered and ignores seq values at or below the last event', () => {
    const store = createAppStore();

    store.getState().appendEvent('thread-1', textEvent(1));
    store.getState().appendEvent('thread-1', textEvent(3));
    store.getState().appendEvent('thread-1', textEvent(2));
    store.getState().appendEvent('thread-1', textEvent(3));

    expect(seqs(store)).toEqual([1, 3]);
  });

  it('dedupes by seq within a thread and keeps threads separate', () => {
    const store = createAppStore();

    store.getState().appendEvent('thread-1', textEvent(1));
    store.getState().appendEvent('thread-1', textEvent(1));
    store.getState().appendEvent('thread-2', textEvent(1, 'thread-2'));

    expect(seqs(store, 'thread-1')).toEqual([1]);
    expect(seqs(store, 'thread-2')).toEqual([1]);
  });

  it('caps each thread at 5000 events and keeps the newest ones', () => {
    const store = createAppStore();

    for (let seq = 0; seq <= MAX_EVENTS_PER_THREAD; seq += 1) {
      store.getState().appendEvent('thread-1', textEvent(seq));
    }

    const kept = seqs(store);
    expect(kept).toHaveLength(MAX_EVENTS_PER_THREAD);
    expect(kept[0]).toBe(1);
    expect(kept.at(-1)).toBe(MAX_EVENTS_PER_THREAD);
  });
});
