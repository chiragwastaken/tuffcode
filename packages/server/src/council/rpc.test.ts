import type { Goal } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { createCouncilHandlers } from './rpc.js';
import type { Council, CouncilStatus } from './types.js';

const goal: Goal = {
  id: 'gol_1',
  threadId: 'thr_1',
  text: 'Ship the widget',
  autonomy: 'auto',
  state: 'running',
  createdAt: '2026-11-24T10:00:00.000Z',
  reportedAt: null,
};

const status: CouncilStatus = { goal, tasks: [], reviews: [] };

function fakeCouncil(): { council: Council; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    council: {
      start: async (input) => {
        calls.push(`start:${input.threadId}:${input.autonomy}`);
        return { goalId: goal.id };
      },
      cancel: async (goalId) => {
        calls.push(`cancel:${goalId}`);
      },
      status: (goalId) => {
        calls.push(`status:${goalId}`);
        return status;
      },
      awaitGoal: async () => goal,
      dispose: async () => undefined,
    },
  };
}

describe('createCouncilHandlers', () => {
  it('registers exactly the three council methods', () => {
    const { council } = fakeCouncil();
    expect(Array.from(createCouncilHandlers({ council }).keys()).toSorted()).toEqual([
      'council.cancel',
      'council.start',
      'council.status',
    ]);
  });

  it('delegates start, cancel, and status', async () => {
    const { council, calls } = fakeCouncil();
    const handlers = createCouncilHandlers({ council });

    await expect(
      handlers.get('council.start')?.({
        threadId: 'thr_1',
        goal: 'Ship the widget',
        autonomy: 'auto',
      }),
    ).resolves.toEqual({ goalId: 'gol_1' });
    await expect(handlers.get('council.cancel')?.({ goalId: 'gol_1' })).resolves.toEqual({});
    expect(handlers.get('council.status')?.({ goalId: 'gol_1' })).toBe(status);
    expect(calls).toEqual(['start:thr_1:auto', 'cancel:gol_1', 'status:gol_1']);
  });
});
