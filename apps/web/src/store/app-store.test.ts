import type { AdapterEvent, Message, ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS_PER_SUBAGENT,
  MAX_EVENTS_PER_THREAD,
  createAppStore,
  mergeSubagentView,
  type SubagentChild,
} from './app-store';

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

function childEvent(seq: number, text = `chunk ${seq}`): AdapterEvent {
  return { type: 'text.delta', turnId: 'turn-child', text };
}

function startChild(
  store: ReturnType<typeof createAppStore>,
  childId = 'child-1',
  threadId = 'thread-1',
): void {
  store.getState().subagentStarted({ childId, threadId, type: 'explorer', model: 'mock-model' });
}

describe('app store subagents', () => {
  it('keys children by id and appends their events with a per-child cursor', () => {
    const store = createAppStore();
    startChild(store, 'child-1');
    startChild(store, 'child-2');

    store
      .getState()
      .subagentEvent({ childId: 'child-1', threadId: 'thread-1', event: childEvent(0) });
    store
      .getState()
      .subagentEvent({ childId: 'child-2', threadId: 'thread-1', event: childEvent(0) });
    store
      .getState()
      .subagentEvent({ childId: 'child-1', threadId: 'thread-1', event: childEvent(1) });

    const first = store.getState().subagents['child-1'];
    const second = store.getState().subagents['child-2'];
    expect(first?.events.map((row) => row.seq)).toEqual([0, 1]);
    expect(second?.events.map((row) => row.seq)).toEqual([0]);
    expect(first?.nextSeq).toBe(2);
    expect(first?.type).toBe('explorer');
    expect(first?.model).toBe('mock-model');
    expect(first?.status).toBe('running');
  });

  it('caps each child at 2000 events and keeps the newest', () => {
    const store = createAppStore();
    startChild(store);

    for (let seq = 0; seq <= MAX_EVENTS_PER_SUBAGENT; seq += 1) {
      store
        .getState()
        .subagentEvent({ childId: 'child-1', threadId: 'thread-1', event: childEvent(seq) });
    }

    const events = store.getState().subagents['child-1']?.events ?? [];
    expect(events).toHaveLength(MAX_EVENTS_PER_SUBAGENT);
    expect(events[0]?.seq).toBe(1);
    expect(events.at(-1)?.seq).toBe(MAX_EVENTS_PER_SUBAGENT);
  });

  it('settles once: finished sets status, summary and time, and a late start cannot revive it', () => {
    const store = createAppStore();
    startChild(store);

    store.getState().subagentFinished({
      childId: 'child-1',
      threadId: 'thread-1',
      status: 'done',
      summary: 'mapped the project',
    });
    const settled = store.getState().subagents['child-1'];
    expect(settled?.status).toBe('done');
    expect(settled?.summary).toBe('mapped the project');
    expect(settled?.finishedAt).not.toBeNull();

    store.getState().subagentStarted({
      childId: 'child-1',
      threadId: 'thread-1',
      type: 'explorer',
      model: 'mock-model',
    });
    expect(store.getState().subagents['child-1']?.status).toBe('done');
  });

  it('creates a child when a finished frame arrives before its started frame', () => {
    const store = createAppStore();

    store.getState().subagentFinished({
      childId: 'child-1',
      threadId: 'thread-1',
      status: 'failed',
    });

    const child = store.getState().subagents['child-1'];
    expect(child?.status).toBe('failed');
    expect(child?.threadId).toBe('thread-1');
  });

  it('merges list rows into live children without reverting a settled status', () => {
    const store = createAppStore();
    startChild(store);
    store.getState().subagentFinished({ childId: 'child-1', threadId: 'thread-1', status: 'done' });
    expect(store.getState().subagents['child-1']?.childThreadId).toBeNull();

    store.getState().mergeSubagentViews('thread-1', [
      {
        childId: 'child-1',
        threadId: 'thread-1',
        childThreadId: 'child-thread-1',
        type: 'explorer',
        model: 'mock-model',
        providerId: 'provider-1',
        status: 'running',
        task: 'map the project',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:05.000Z',
      },
    ]);

    const child = store.getState().subagents['child-1'];
    expect(child?.status).toBe('done');
    expect(child?.task).toBe('map the project');
    expect(child?.childThreadId).toBe('child-thread-1');
  });

  it('drops list rows from another thread', () => {
    const store = createAppStore();

    store.getState().mergeSubagentViews('thread-1', [
      {
        childId: 'child-9',
        threadId: 'thread-2',
        childThreadId: 'child-thread-9',
        type: 'worker',
        model: 'mock-model',
        providerId: 'provider-1',
        status: 'queued',
        task: 'other',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(store.getState().subagents['child-9']).toBeUndefined();
  });

  it('opens, selects and closes the pane while remembering the selected tab', () => {
    const store = createAppStore();
    startChild(store, 'child-1');
    startChild(store, 'child-2');

    store.getState().openSubagent('child-1');
    expect(store.getState().subagentPane).toEqual({ open: true, activeChildId: 'child-1' });

    store.getState().selectSubagent('child-2');
    expect(store.getState().subagentPane).toEqual({ open: true, activeChildId: 'child-2' });

    store.getState().closeSubagentPane();
    expect(store.getState().subagentPane).toEqual({ open: false, activeChildId: 'child-2' });

    store.getState().openSubagent('missing');
    expect(store.getState().subagentPane).toEqual({ open: false, activeChildId: 'child-2' });
  });

  it('prunes children and the pane selection with their thread', () => {
    const store = createAppStore();
    startChild(store, 'child-1');
    store.getState().openSubagent('child-1');

    store.getState().removeThread('thread-1');

    expect(store.getState().subagents['child-1']).toBeUndefined();
    expect(store.getState().subagentPane).toEqual({ open: false, activeChildId: null });
  });
});

describe('mergeSubagentView', () => {
  const view = {
    childId: 'child-1',
    threadId: 'thread-1',
    childThreadId: 'child-thread-1',
    type: 'reviewer' as const,
    model: 'other-model',
    providerId: 'provider-1',
    status: 'done' as const,
    task: 'review the diff',
    summary: 'one blocker',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:09.000Z',
  };

  it('creates a settled child from a list row alone', () => {
    const child: SubagentChild = mergeSubagentView(undefined, view);
    expect(child.status).toBe('done');
    expect(child.summary).toBe('one blocker');
    expect(child.childThreadId).toBe('child-thread-1');
    expect(child.finishedAt).toBe('2026-01-01T00:00:09.000Z');
    expect(child.events).toEqual([]);
  });

  it('keeps a known child thread when a stale row has not seen one yet', () => {
    const live = mergeSubagentView(undefined, view);
    const stale = mergeSubagentView(live, { ...view, childThreadId: null });
    expect(stale.childThreadId).toBe('child-thread-1');
  });
});
