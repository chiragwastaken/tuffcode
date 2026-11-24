import type { AdapterEvent, ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import type { SubagentChild } from '../../store/app-store';
import {
  connectorGeometry,
  placeSubagents,
  selectActiveSubagent,
  subagentElapsedMs,
  subagentStripLabel,
  subagentTypeCounts,
  subagentsOfThread,
  turnOrdinals,
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

function row(seq: number, payload: AdapterEvent): ThreadEventRow {
  return {
    id: seq + 1,
    threadId: 'thread-1',
    seq,
    type: payload.type,
    payload,
    createdAt: T0,
  };
}

function toolStarted(
  turnId: string,
  toolCallId: string,
  name: string,
  input: unknown,
): AdapterEvent {
  return { type: 'tool.started', turnId, toolCallId, name, input };
}

function toolFinished(turnId: string, toolCallId: string, output: string): AdapterEvent {
  return { type: 'tool.finished', turnId, toolCallId, output, isError: false };
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

describe('subagentStripLabel', () => {
  it('counts running children first', () => {
    const running = [child({ childId: 'a' }), child({ childId: 'b', type: 'worker' })];
    const settled = child({ childId: 'c', status: 'done', finishedAt: T0 });

    expect(subagentStripLabel([...running, settled])).toBe('2 subagents running');
    expect(subagentStripLabel([settled])).toBe('1 subagent');
    expect(subagentStripLabel([running[0] as SubagentChild])).toBe('1 subagent running');
    expect(subagentStripLabel([settled, settled, settled])).toBe('3 subagents');
  });
});

describe('subagentTypeCounts', () => {
  it('groups one icon per type in first-seen order', () => {
    const counts = subagentTypeCounts([
      child({ childId: 'a', type: 'explorer' }),
      child({ childId: 'b', type: 'worker' }),
      child({ childId: 'c', type: 'explorer' }),
    ]);

    expect(counts).toEqual([
      { type: 'explorer', count: 2 },
      { type: 'worker', count: 1 },
    ]);
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

describe('turnOrdinals', () => {
  it('numbers turns by first appearance', () => {
    const ordinals = turnOrdinals([
      row(0, { type: 'turn.started', turnId: 'turn-a' }),
      row(1, toolStarted('turn-a', 'call-1', 'bash', {})),
      row(2, { type: 'turn.finished', turnId: 'turn-a', reason: 'complete' }),
      row(3, { type: 'turn.started', turnId: 'turn-b' }),
    ]);

    expect(ordinals.get('turn-a')).toBe(1);
    expect(ordinals.get('turn-b')).toBe(2);
  });
});

describe('placeSubagents', () => {
  it('attributes a settled spawn by the child id in the tool output', () => {
    const events = [
      row(0, { type: 'turn.started', turnId: 'turn-1' }),
      row(1, toolStarted('turn-1', 'call-1', 'subagent', { type: 'explorer', task: 'map it' })),
      row(
        2,
        toolFinished(
          'turn-1',
          'call-1',
          'subagent child-abc (explorer) running. Poll subagents.list for its summary.',
        ),
      ),
    ];

    const placement = placeSubagents([child({ childId: 'child-abc', task: 'map it' })], events);

    expect(placement.unplaced).toEqual([]);
    expect(placement.groups).toHaveLength(1);
    expect(placement.groups[0]?.turnId).toBe('turn-1');
    expect(placement.groups[0]?.label).toBe('Turn 1');
  });

  it('attributes a running spawn by the task text and does not double-claim a tool', () => {
    const events = [
      row(0, toolStarted('turn-1', 'call-1', 'subagent', { task: 'map the project' })),
      row(1, toolStarted('turn-2', 'call-2', 'subagent', { task: 'review the diff' })),
    ];

    const placement = placeSubagents(
      [
        child({ childId: 'child-1', task: 'review the diff' }),
        child({ childId: 'child-2', task: 'map the project' }),
      ],
      events,
    );

    expect(placement.groups.map((group) => [group.turnId, group.children[0]?.childId])).toEqual([
      ['turn-1', 'child-2'],
      ['turn-2', 'child-1'],
    ]);
  });

  it('leaves a child without a spawn row unplaced', () => {
    const placement = placeSubagents([child({ childId: 'child-1', task: 'orphan' })], []);
    expect(placement.groups).toEqual([]);
    expect(placement.unplaced.map((entry) => entry.childId)).toEqual(['child-1']);
  });
});

describe('connectorGeometry', () => {
  it('draws a cubic from the card right edge to the pane header left edge', () => {
    const geometry = connectorGeometry(
      { left: 100, top: 200, width: 200, height: 60 },
      { left: 800, top: 100, width: 400, height: 40 },
      { left: 0, top: 0, width: 1200, height: 900 },
    );

    expect(geometry).toEqual({
      x1: 300,
      y1: 230,
      x2: 800,
      y2: 120,
      d: 'M 300 230 C 348 230, 752 120, 800 120',
    });
  });

  it('is relative to the pane origin and keeps a 16px minimum bend', () => {
    const geometry = connectorGeometry(
      { left: 700, top: 200, width: 70, height: 60 },
      { left: 800, top: 100, width: 400, height: 40 },
      { left: 780, top: 0, width: 420, height: 900 },
    );

    expect(geometry.x1).toBe(-10);
    expect(geometry.x2).toBe(20);
    expect(geometry.d).toBe('M -10 230 C 6 230, 4 120, 20 120');
  });
});
