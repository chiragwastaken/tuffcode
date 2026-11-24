import type { AdapterEvent } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus } from '../events.js';
import type { Runner } from '../runner/runner.js';
import { createBusTurnRunner } from './runner-turn.js';

type SendBehavior = 'complete' | 'abort' | 'throw';

function fakeRunner(bus: EventBus, behavior: SendBehavior): Runner {
  const emit = (threadId: string, event: AdapterEvent): void => {
    bus.emit({ kind: 'event', type: 'thread.event', threadId, seq: 1, payload: event });
  };
  return {
    listActive: () => [],
    send: async (threadId) => {
      if (behavior === 'throw') throw new Error('adapter exploded');
      const turnId = 'turn_1';
      queueMicrotask(() => {
        emit(threadId, { type: 'text.delta', turnId, text: 'hello ' });
        if (behavior === 'complete') {
          emit(threadId, { type: 'text.delta', turnId, text: 'world' });
          emit(threadId, { type: 'turn.finished', turnId, reason: 'complete' });
        }
      });
      return { turnId };
    },
    interrupt: async () => undefined,
    approve: async () => undefined,
    disposeThread: async () => undefined,
    disposeAll: async () => undefined,
    recoverOrphanedRuns: () => undefined,
  };
}

describe('createBusTurnRunner', () => {
  it('accumulates text deltas and settles on the matching turn.finished', async () => {
    const bus = createEventBus();
    const runTurn = createBusTurnRunner({ bus, runner: fakeRunner(bus, 'complete') });
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      threadId: 'thr_1',
      turnId: 'turn_1',
      status: 'complete',
      text: 'hello world',
    });
  });

  it('ignores events from other threads', async () => {
    const bus = createEventBus();
    const runner = fakeRunner(bus, 'complete');
    const runTurn = createBusTurnRunner({ bus, runner });
    const { promise, resolve } = Promise.withResolvers<void>();
    bus.subscribe((event) => {
      if (event.type === 'thread.event' && event.threadId === 'thr_1') return;
      if (event.type === 'thread.event') resolve();
    });
    const resultPromise = runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
    });
    bus.emit({
      kind: 'event',
      type: 'thread.event',
      threadId: 'thr_other',
      seq: 1,
      payload: { type: 'text.delta', turnId: 'turn_x', text: 'not mine' },
    });
    await promise;
    const result = await resultPromise;
    expect(result.text).toBe('hello world');
  });

  it('settles interrupted as soon as the signal aborts', async () => {
    const bus = createEventBus();
    const runner = fakeRunner(bus, 'abort');
    const runTurn = createBusTurnRunner({ bus, runner });
    const controller = new AbortController();
    const resultPromise = runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => {
      bus.subscribe((event) => {
        if (event.type === 'thread.event' && event.payload.type === 'text.delta') resolve();
      });
    });
    controller.abort();
    const result = await resultPromise;
    expect(result.status).toBe('interrupted');
    expect(result.text).toBe('hello ');
  });

  it('returns interrupted without sending when the signal is already aborted', async () => {
    const bus = createEventBus();
    let sent = 0;
    const runner: Runner = {
      ...fakeRunner(bus, 'complete'),
      send: async () => {
        sent += 1;
        return { turnId: 'turn_1' };
      },
    };
    const runTurn = createBusTurnRunner({ bus, runner });
    const controller = new AbortController();
    controller.abort();
    const result = await runTurn({ threadId: 'thr_1', text: 'work', signal: controller.signal });
    expect(result.status).toBe('interrupted');
    expect(sent).toBe(0);
  });

  it('turns a rejected send into an error result', async () => {
    const bus = createEventBus();
    const runTurn = createBusTurnRunner({ bus, runner: fakeRunner(bus, 'throw') });
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('adapter exploded');
  });
});
