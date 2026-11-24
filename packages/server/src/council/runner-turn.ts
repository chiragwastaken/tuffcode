import type { EventBus } from '../events.js';
import type { Runner } from '../runner/runner.js';
import type { RunTurnInput, TurnResult } from './types.js';

export interface BusTurnRunnerDeps {
  bus: EventBus;
  runner: Runner;
}

/**
 * Turns one runner send into an awaitable result by watching the event bus. The
 * runner deliberately returns before the turn runs, so council subscribes first,
 * buffers text deltas, and settles on the `turn.finished` frame for the turn id the
 * send returned. Abort settles as interrupted without waiting for a wedged adapter;
 * cancellation has already told the runner to dispose the thread.
 */
export function createBusTurnRunner(
  deps: BusTurnRunnerDeps,
): (input: RunTurnInput) => Promise<TurnResult> {
  return async ({ threadId, text, signal }) => {
    if (signal.aborted) {
      return { threadId, turnId: '', status: 'interrupted', text: '' };
    }

    let buffer = '';
    let currentTurnId: string | null = null;
    const finished: { value: { turnId: string; reason: TurnResult['status'] } | null } = {
      value: null,
    };
    let settled = false;
    const { promise, resolve } = Promise.withResolvers<TurnResult>();
    const settle = (result: TurnResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const unsubscribe = deps.bus.subscribe((event) => {
      if (event.type !== 'thread.event' || event.threadId !== threadId) return;
      const payload = event.payload;
      if (payload.type === 'text.delta') {
        buffer += payload.text;
        return;
      }
      if (payload.type !== 'turn.finished') return;
      finished.value = { turnId: payload.turnId, reason: payload.reason };
      if (currentTurnId === payload.turnId) {
        settle({ threadId, turnId: payload.turnId, status: payload.reason, text: buffer });
      }
    });

    const onAbort = (): void => {
      settle({ threadId, turnId: currentTurnId ?? '', status: 'interrupted', text: buffer });
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const sent = await deps.runner.send(threadId, text);
      currentTurnId = sent.turnId;
      if (finished.value !== null && finished.value.turnId === sent.turnId) {
        settle({ threadId, turnId: sent.turnId, status: finished.value.reason, text: buffer });
      }
    } catch (error) {
      settle({
        threadId,
        turnId: '',
        status: 'error',
        text: buffer,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      return await promise;
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
    }
  };
}
