import { describe, expect, it } from 'vitest';
import type { SubagentChild } from '../../store/app-store';
import {
  SUBAGENT_CHIP_LIMIT,
  selectActiveSubagent,
  subagentElapsedMs,
  subagentFinishedLabel,
  subagentStripChips,
  subagentsOfThread,
  type SubagentChip,
} from './subagent-model';

const T0 = '2026-01-01T00:00:00.000Z';

function child(overrides: Partial<SubagentChild> & { childId: string }): SubagentChild {
  return {
    threadId: 'thread-1',
    type: 'explorer',
    model: 'mock-model',
    status: 'running',
    task: '',
    summary: null,
    createdAt: T0,
    startedAt: T0,
    finishedAt: null,
    events: [],
    nextSeq: 0,
    ...overrides,
  };
}

function settled(childId: string): SubagentChild {
  return child({ childId, status: 'done', finishedAt: T0 });
}

/** Chip identities in row order, with the two aggregate chips named by kind. */
function chipIds(chips: readonly SubagentChip[]): string[] {
  return chips.map((chip) => (chip.kind === 'child' ? chip.child.childId : chip.kind));
}

describe('selectActiveSubagent', () => {
  const running = child({ childId: 'c-running', task: 'map' });
  const done = child({ childId: 'c-done', status: 'done', finishedAt: T0 });

  it('returns the requested child when it belongs to the thread', () => {
    expect(selectActiveSubagent([done, running], 'c-done')?.childId).toBe('c-done');
  });

  it('falls back to the first running child, then to the first child', () => {
    expect(selectActiveSubagent([done, running], null)?.childId).toBe('c-running');
    expect(selectActiveSubagent([done], 'missing')?.childId).toBe('c-done');
    expect(selectActiveSubagent([], 'missing')).toBeNull();
  });
});

describe('subagentsOfThread', () => {
  it('keeps spawn order and drops children of other threads', () => {
    const first = child({ childId: 'c1' });
    const second = child({ childId: 'c2', threadId: 'thread-2' });
    const third = child({ childId: 'c3' });

    const registry = { c1: first, c2: second, c3: third };
    expect(subagentsOfThread(registry, 'thread-1').map((entry) => entry.childId)).toEqual([
      'c1',
      'c3',
    ]);
  });
});

describe('subagentStripChips', () => {
  it('draws one chip per child while the row fits four', () => {
    const chips = subagentStripChips([
      child({ childId: 'a' }),
      child({ childId: 'b', type: 'worker' }),
      settled('c'),
      child({ childId: 'd', type: 'reviewer' }),
    ]);

    expect(SUBAGENT_CHIP_LIMIT).toBe(4);
    expect(chipIds(chips)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the first three running children and folds the rest into a count', () => {
    const chips = subagentStripChips([
      child({ childId: 'r1' }),
      child({ childId: 'r2' }),
      child({ childId: 'r3' }),
      child({ childId: 'r4' }),
      settled('s1'),
    ]);

    expect(chipIds(chips)).toEqual(['r1', 'r2', 'r3', 'more']);
    expect(chips[3]).toEqual({ kind: 'more', count: 2, childId: 'r1' });
  });

  it('keeps only the running children when they are the ones that fit', () => {
    const chips = subagentStripChips([
      settled('s1'),
      child({ childId: 'r1' }),
      child({ childId: 'r2' }),
      settled('s2'),
      settled('s3'),
      settled('s4'),
    ]);

    expect(chipIds(chips)).toEqual(['r1', 'r2', 'more']);
    expect(chips[2]).toEqual({ kind: 'more', count: 4, childId: 'r1' });
  });

  it('folds a settled set into one finished chip on the last child', () => {
    expect(subagentStripChips([settled('s1'), settled('s2'), settled('s3')])).toEqual([
      { kind: 'finished', count: 3, label: '3 subagents finished', childId: 's3' },
    ]);
  });

  it('has no chips before the first spawn', () => {
    expect(subagentStripChips([])).toEqual([]);
  });
});

describe('subagentFinishedLabel', () => {
  it('counts one child and many children', () => {
    expect(subagentFinishedLabel(1)).toBe('1 subagent finished');
    expect(subagentFinishedLabel(4)).toBe('4 subagents finished');
  });
});

describe('subagentElapsedMs', () => {
  it('counts to now while running and to the finish time once settled', () => {
    const started = '2026-01-01T00:00:00.000Z';
    const finished = '2026-01-01T00:00:04.500Z';

    expect(
      subagentElapsedMs(child({ childId: 'a', startedAt: started }), Date.parse(finished)),
    ).toBe(4500);
    expect(
      subagentElapsedMs(
        child({ childId: 'a', startedAt: started, status: 'done', finishedAt: finished }),
        Date.parse('2026-01-01T00:01:00.000Z'),
      ),
    ).toBe(4500);
    expect(subagentElapsedMs(child({ childId: 'a', startedAt: null }), 1)).toBeNull();
  });
});
