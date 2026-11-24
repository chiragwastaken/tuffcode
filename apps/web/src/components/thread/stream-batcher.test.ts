import type { ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createStreamBatcher, type FrameScheduler } from './stream-batcher';

function row(seq: number): ThreadEventRow {
  return {
    id: seq + 1,
    threadId: 'thread-1',
    seq,
    type: 'text.delta',
    payload: { type: 'text.delta', turnId: 'turn-1', text: `chunk ${seq}` },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function createScheduler() {
  let time = 0;
  let nextHandle = 1;
  const frames = new Map<number, () => void>();

  const scheduler: FrameScheduler = {
    now: () => time,
    requestFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
  };

  return {
    scheduler,
    pendingFrames: () => frames.size,
    runFrame(at: number) {
      time = at;
      const entry = frames.entries().next();
      if (entry.done) throw new Error('No frame scheduled.');
      const [handle, callback] = entry.value;
      frames.delete(handle);
      callback();
    },
  };
}

describe('createStreamBatcher', () => {
  it('flushes queued events on the first frame', () => {
    const scheduler = createScheduler();
    const flush = vi.fn();
    const batcher = createStreamBatcher({ flush, scheduler: scheduler.scheduler });

    batcher.push(row(1));
    batcher.push(row(2));
    expect(flush).not.toHaveBeenCalled();
    expect(batcher.pendingCount()).toBe(2);

    scheduler.runFrame(16);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]?.[0].map((event: ThreadEventRow) => event.seq)).toEqual([1, 2]);
    expect(batcher.pendingCount()).toBe(0);
  });

  it('waits out the interval before the next flush', () => {
    const scheduler = createScheduler();
    const flush = vi.fn();
    const batcher = createStreamBatcher({
      flush,
      scheduler: scheduler.scheduler,
      intervalMs: 50,
    });

    batcher.push(row(1));
    scheduler.runFrame(0);
    expect(flush).toHaveBeenCalledTimes(1);

    batcher.push(row(2));
    scheduler.runFrame(16);
    expect(flush).toHaveBeenCalledTimes(1);
    scheduler.runFrame(33);
    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.runFrame(50);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.calls[1]?.[0].map((event: ThreadEventRow) => event.seq)).toEqual([2]);
  });

  it('coalesces deltas that arrive between frames into one flush', () => {
    const scheduler = createScheduler();
    const flush = vi.fn();
    const batcher = createStreamBatcher({ flush, scheduler: scheduler.scheduler });

    batcher.push(row(1));
    scheduler.runFrame(0);
    batcher.push(row(2));
    batcher.push(row(3));
    batcher.push(row(4));
    scheduler.runFrame(60);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.calls[1]?.[0].map((event: ThreadEventRow) => event.seq)).toEqual([2, 3, 4]);
  });

  it('flushes remaining events on dispose and cancels the pending frame', () => {
    const scheduler = createScheduler();
    const flush = vi.fn();
    const batcher = createStreamBatcher({ flush, scheduler: scheduler.scheduler });

    batcher.push(row(1));
    batcher.dispose();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingFrames()).toBe(0);

    batcher.push(row(2));
    expect(scheduler.pendingFrames()).toBe(1);
    scheduler.runFrame(100);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
