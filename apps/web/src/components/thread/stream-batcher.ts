import type { ThreadEventRow } from '@tuffcode/contracts';

export const STREAM_FLUSH_MS = 50;

export interface FrameScheduler {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export interface StreamBatcherOptions {
  flush: (events: ThreadEventRow[]) => void;
  scheduler?: FrameScheduler;
  intervalMs?: number;
}

export interface StreamBatcher {
  push(event: ThreadEventRow): void;
  dispose(): void;
  pendingCount(): number;
}

/**
 * Collects streaming rows and releases them at most once per interval. The first
 * frame after a quiet period flushes immediately, so a single delta still lands
 * without waiting.
 */
export function createStreamBatcher({
  flush,
  scheduler = browserScheduler,
  intervalMs = STREAM_FLUSH_MS,
}: StreamBatcherOptions): StreamBatcher {
  let queue: ThreadEventRow[] = [];
  let frame: number | null = null;
  let lastFlushAt: number | null = null;

  function drain(): void {
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    lastFlushAt = scheduler.now();
    flush(events);
  }

  function schedule(): void {
    if (frame !== null) return;
    frame = scheduler.requestFrame(onFrame);
  }

  function onFrame(): void {
    frame = null;
    if (queue.length === 0) return;
    const now = scheduler.now();
    if (lastFlushAt !== null && now - lastFlushAt < intervalMs) {
      schedule();
      return;
    }
    drain();
  }

  return {
    push(event) {
      queue.push(event);
      schedule();
    },
    dispose() {
      if (frame !== null) {
        scheduler.cancelFrame(frame);
        frame = null;
      }
      drain();
    },
    pendingCount() {
      return queue.length;
    },
  };
}
