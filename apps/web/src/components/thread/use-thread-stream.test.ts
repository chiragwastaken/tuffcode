import type { AdapterEvent, ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/app-store';
import type { ConnectionStatus } from '../../types';
import { createThreadReplayController } from './use-thread-stream';

function connection(initial: ConnectionStatus) {
  const listeners = new Set<(status: ConnectionStatus) => void>();
  let current = initial;
  return {
    source: {
      getStatus: () => current,
      onStatus: (callback: (status: ConnectionStatus) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
    emit(next: ConnectionStatus) {
      current = next;
      for (const listener of listeners) listener(next);
    },
    listenerCount: () => listeners.size,
  };
}

function row(seq: number, payload: AdapterEvent): ThreadEventRow {
  return {
    id: seq + 1,
    threadId: 'thread-1',
    seq,
    type: payload.type,
    payload,
    createdAt: `2026-01-01T00:00:0${seq % 10}.000Z`,
  };
}

function turnStarted(seq: number, turnId: string): ThreadEventRow {
  return row(seq, { type: 'turn.started', turnId });
}

function turnFinished(seq: number, turnId: string): ThreadEventRow {
  return row(seq, { type: 'turn.finished', turnId, reason: 'complete' });
}

function lastSeqOf(store: ReturnType<typeof createAppStore>): number {
  return store.getState().events['thread-1']?.at(-1)?.seq ?? 0;
}

/** The web tsconfig targets pre-ES2024, so Promise.withResolvers is unavailable. */
const NOOP = (): void => undefined;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle: () => void = NOOP;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle() };
}

describe('thread replay controller', () => {
  it('replays from the stored seq after a reconnect and never duplicates rows', async () => {
    const store = createAppStore();
    const conn = connection('open');
    const replay = vi.fn(async (sinceSeq: number) => {
      if (sinceSeq === 0) {
        store.getState().appendEvent('thread-1', turnStarted(1, 'turn-1'));
        store.getState().appendEvent('thread-1', turnFinished(2, 'turn-1'));
      }
      if (sinceSeq === 2) {
        store.getState().appendEvent('thread-1', turnStarted(3, 'turn-2'));
        store.getState().appendEvent('thread-1', turnFinished(4, 'turn-2'));
      }
      return { hasMore: false };
    });
    const onInitialReplay = vi.fn();
    const controller = createThreadReplayController({
      connection: conn.source,
      replay,
      lastSeq: () => lastSeqOf(store),
      onInitialReplay,
      onInitialError: () => undefined,
    });

    controller.start(0);
    await vi.waitFor(() => expect(onInitialReplay).toHaveBeenCalledTimes(1));
    expect(replay).toHaveBeenCalledWith(0);

    // The socket drops while a turn runs and reopens after the turn finished.
    conn.emit('closed');
    conn.emit('open');
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
    expect(replay).toHaveBeenLastCalledWith(2);
    expect(store.getState().events['thread-1']?.map((event) => event.seq)).toEqual([1, 2, 3, 4]);

    // A second reconnect with nothing new appends no duplicate rows.
    conn.emit('closed');
    conn.emit('open');
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(3));
    expect(replay).toHaveBeenLastCalledWith(4);
    expect(store.getState().events['thread-1']?.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    controller.dispose();
  });

  it('does not start a reconnect replay before the first replay settles', async () => {
    const store = createAppStore();
    const conn = connection('connecting');
    const firstGate = deferred();
    const replay = vi.fn(async (sinceSeq: number) => {
      if (sinceSeq === 0) {
        store.getState().appendEvent('thread-1', turnStarted(1, 'turn-1'));
        await firstGate.promise;
      }
      return { hasMore: false };
    });
    const onInitialReplay = vi.fn();
    const controller = createThreadReplayController({
      connection: conn.source,
      replay,
      lastSeq: () => lastSeqOf(store),
      onInitialReplay,
      onInitialError: () => undefined,
    });

    controller.start(0);
    conn.emit('open');
    await Promise.resolve();
    expect(replay).toHaveBeenCalledTimes(1);
    expect(onInitialReplay).not.toHaveBeenCalled();

    firstGate.resolve();
    await vi.waitFor(() => expect(onInitialReplay).toHaveBeenCalledTimes(1));
    expect(replay).toHaveBeenCalledTimes(1);

    conn.emit('closed');
    conn.emit('open');
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
    expect(replay).toHaveBeenLastCalledWith(1);
    controller.dispose();
  });

  it('queues one reconnect replay while another is in flight', async () => {
    const store = createAppStore();
    const conn = connection('open');
    const reconnectGate = deferred();
    const replay = vi.fn(async (sinceSeq: number) => {
      if (sinceSeq === 0) {
        store.getState().appendEvent('thread-1', turnStarted(1, 'turn-1'));
        return { hasMore: false };
      }
      if (sinceSeq === 1) {
        await reconnectGate.promise;
      }
      return { hasMore: false };
    });
    const onInitialReplay = vi.fn();
    const controller = createThreadReplayController({
      connection: conn.source,
      replay,
      lastSeq: () => lastSeqOf(store),
      onInitialReplay,
      onInitialError: () => undefined,
    });

    controller.start(0);
    await vi.waitFor(() => expect(onInitialReplay).toHaveBeenCalledTimes(1));

    conn.emit('closed');
    conn.emit('open');
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));

    conn.emit('closed');
    conn.emit('open');
    await Promise.resolve();
    expect(replay).toHaveBeenCalledTimes(2);

    reconnectGate.resolve();
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(3));
    expect(replay).toHaveBeenLastCalledWith(1);
    controller.dispose();
  });

  it('keeps the connection usable when a reconnect replay fails and retries next time', async () => {
    const store = createAppStore();
    const conn = connection('open');
    const logger = { warn: vi.fn() };
    const replay = vi.fn(async (sinceSeq: number) => {
      if (sinceSeq === 0) {
        store.getState().appendEvent('thread-1', turnStarted(1, 'turn-1'));
        return { hasMore: false };
      }
      if (sinceSeq === 1) throw new Error('socket dropped again');
      return { hasMore: false };
    });
    const onInitialError = vi.fn();
    const controller = createThreadReplayController({
      connection: conn.source,
      replay,
      lastSeq: () => lastSeqOf(store),
      onInitialReplay: () => undefined,
      onInitialError,
      logger,
    });

    controller.start(0);
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(1));

    conn.emit('closed');
    conn.emit('open');
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(1));
    expect(onInitialError).not.toHaveBeenCalled();

    conn.emit('closed');
    conn.emit('open');
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(3));
    controller.dispose();
  });

  it('reports an initial replay failure once and still releases live frames', async () => {
    const conn = connection('open');
    const onInitialReplay = vi.fn();
    const onInitialError = vi.fn();
    const controller = createThreadReplayController({
      connection: conn.source,
      replay: async () => {
        throw new Error('history unavailable');
      },
      lastSeq: () => 0,
      onInitialReplay,
      onInitialError,
    });

    controller.start(0);
    await vi.waitFor(() => expect(onInitialError).toHaveBeenCalledTimes(1));
    expect(onInitialReplay).toHaveBeenCalledTimes(1);
    expect(onInitialError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    controller.dispose();
  });

  it('unsubscribes from status and ignores replays after dispose', async () => {
    const conn = connection('open');
    const replay = vi.fn(async () => ({ hasMore: false }));
    const controller = createThreadReplayController({
      connection: conn.source,
      replay,
      lastSeq: () => 0,
      onInitialReplay: () => undefined,
      onInitialError: () => undefined,
    });
    controller.start(0);
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(1));

    controller.dispose();
    expect(conn.listenerCount()).toBe(0);
    conn.emit('closed');
    conn.emit('open');
    await Promise.resolve();
    expect(replay).toHaveBeenCalledTimes(1);
  });
});
