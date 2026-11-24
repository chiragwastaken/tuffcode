import type { Message, ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_EVENTS_PER_THREAD, createAppStore } from './app-store';

function message(id: string, threadId = 'thread-1'): Message {
  return {
    id,
    threadId,
    role: 'user',
    content: id,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

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

describe('app store messages', () => {
  it('stores persisted rows per thread and replaces them on reload', () => {
    const store = createAppStore();

    store.getState().setMessages('thread-1', [message('msg_turn-1_user')]);
    store.getState().setMessages('thread-2', [message('msg_turn-2_user', 'thread-2')]);

    expect(store.getState().messages['thread-1']?.map((row) => row.id)).toEqual([
      'msg_turn-1_user',
    ]);
    expect(store.getState().messages['thread-2']?.map((row) => row.id)).toEqual([
      'msg_turn-2_user',
    ]);

    store.getState().setMessages('thread-1', [message('msg_turn-3_user')]);
    expect(store.getState().messages['thread-1']?.map((row) => row.id)).toEqual([
      'msg_turn-3_user',
    ]);
  });

  it('drops messages with the thread', () => {
    const store = createAppStore();

    store.getState().upsertThread({
      id: 'thread-1',
      projectId: 'project-1',
      parentThreadId: null,
      title: 'Thread',
      providerId: 'provider-1',
      modelId: 'model-1',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: 'C:/worktree',
      branch: 'tuffcode/thread-1',
      baseBranch: 'main',
      prUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastSeq: 0,
    });
    store.getState().setMessages('thread-1', [message('msg_turn-1_user')]);

    store.getState().removeThread('thread-1');

    expect(store.getState().messages['thread-1']).toBeUndefined();
  });
});
