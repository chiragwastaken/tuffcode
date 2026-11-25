import type { AdapterEvent, ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import type { SubagentChild } from '../../store/app-store';
import {
  activityCount,
  countRunningSubagents,
  runningElapsedMs,
  runningToolCount,
  runningToolRows,
  waitingItems,
} from './activity-model';

let nextRowId = 0;

function row(
  threadId: string,
  payload: AdapterEvent,
  createdAt = '2026-11-25T12:00:00.000Z',
): ThreadEventRow {
  nextRowId += 1;
  return {
    id: nextRowId,
    threadId,
    seq: nextRowId,
    type: payload.type,
    payload,
    createdAt,
  };
}

function started(turnId: string, toolCallId: string, name: string, input: unknown): AdapterEvent {
  return { type: 'tool.started', turnId, toolCallId, name, input };
}

function delta(turnId: string, toolCallId: string, text: string): AdapterEvent {
  return { type: 'tool.delta', turnId, toolCallId, text };
}

function finished(turnId: string, toolCallId: string, output: string): AdapterEvent {
  return { type: 'tool.finished', turnId, toolCallId, output, isError: false };
}

function child(
  overrides: Partial<SubagentChild> & { childId: string; threadId: string },
): SubagentChild {
  return {
    type: 'explorer',
    model: 'model-1',
    status: 'running',
    task: '',
    summary: null,
    createdAt: '2026-11-25T12:00:00.000Z',
    startedAt: '2026-11-25T12:00:00.000Z',
    finishedAt: null,
    events: [],
    nextSeq: 0,
    ...overrides,
  };
}

describe('runningToolRows', () => {
  it('lists an open bash call with its accumulated output', () => {
    const events = [
      row('thr_1', started('turn-1', 'call-1', 'bash', { command: 'pnpm test\n--watch' })),
      row('thr_1', delta('turn-1', 'call-1', 'building\n')),
      row('thr_1', delta('turn-1', 'call-1', '3 tests passed')),
      row('thr_1', started('turn-1', 'call-2', 'read', { path: 'src/index.ts' })),
      row('thr_1', finished('turn-1', 'call-2', 'file body')),
    ];

    const rows = runningToolRows(events);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      key: 'thread:turn-1:call-1',
      childId: null,
      childType: null,
      headline: 'Ran pnpm test',
      output: 'building\n3 tests passed',
      startedAt: '2026-11-25T12:00:00.000Z',
    });
  });

  it('prefixes a child tool with its subagent type', () => {
    const explorer = child({
      childId: 'child_1',
      threadId: 'thr_1',
      type: 'explorer',
      events: [row('thr_1', started('turn-9', 'call-1', 'grep', { pattern: 'TODO' }))],
    });

    const rows = runningToolRows([], [explorer]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'child_1:turn-9:call-1',
      childId: 'child_1',
      childType: 'explorer',
      headline: 'Searched TODO',
    });
  });

  it('keeps the thread tools before its children', () => {
    const events = [row('thr_1', started('turn-1', 'call-1', 'bash', { command: 'pnpm check' }))];
    const worker = child({
      childId: 'child_1',
      threadId: 'thr_1',
      type: 'worker',
      events: [row('thr_1', started('turn-2', 'call-1', 'write', { path: 'a.ts' }))],
    });

    expect(runningToolRows(events, [worker]).map((entry) => entry.childId)).toEqual([
      null,
      'child_1',
    ]);
  });
});

describe('runningToolCount', () => {
  it('counts only calls without a finished frame', () => {
    const events = [
      row('thr_1', started('turn-1', 'call-1', 'bash', {})),
      row('thr_1', started('turn-1', 'call-2', 'bash', {})),
      row('thr_1', finished('turn-1', 'call-2', 'done')),
    ];

    expect(runningToolCount(events)).toBe(1);
  });

  it('keeps a reused call id across turns distinct', () => {
    const events = [
      row('thr_1', started('turn-1', 'call-1', 'bash', {})),
      row('thr_1', started('turn-2', 'call-1', 'bash', {})),
      row('thr_1', finished('turn-1', 'call-1', 'done')),
    ];

    expect(runningToolCount(events)).toBe(1);
  });
});

describe('activityCount', () => {
  const events = [row('thr_1', started('turn-1', 'call-1', 'bash', {}))];
  const subagents: Record<string, SubagentChild> = {
    a: child({ childId: 'a', threadId: 'thr_1', status: 'running' }),
    b: child({ childId: 'b', threadId: 'thr_1', status: 'queued' }),
    c: child({ childId: 'c', threadId: 'thr_1', status: 'done' }),
    d: child({ childId: 'd', threadId: 'thr_2', status: 'running' }),
  };

  it('counts running children only, never queued or settled ones', () => {
    expect(countRunningSubagents(subagents, 'thr_1')).toBe(1);
    expect(countRunningSubagents(subagents, 'thr_2')).toBe(1);
    expect(countRunningSubagents(subagents, 'thr_3')).toBe(0);
  });

  it('adds open tool calls and running children for the thread', () => {
    expect(activityCount(events, subagents, 'thr_1')).toBe(2);
    expect(activityCount(events, subagents, 'thr_2')).toBe(2);
    expect(activityCount([], subagents, 'thr_3')).toBe(0);
  });
});

describe('waitingItems', () => {
  const queuedChild = child({ childId: 'q1', threadId: 'thr_1', status: 'queued' });
  const runningChild = child({ childId: 'r1', threadId: 'thr_1', status: 'running' });

  it('lists queued children and nothing else while no approval is open', () => {
    const items = waitingItems([queuedChild, runningChild], 'running');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'child', child: { childId: 'q1' } });
  });

  it('adds the approval line when the thread needs an approval', () => {
    const items = waitingItems([], 'needs-approval');

    expect(items).toEqual([{ kind: 'approval' }]);
  });

  it('keeps queued children ahead of the approval line', () => {
    const items = waitingItems([queuedChild], 'needs-approval');

    expect(items.map((item) => item.kind)).toEqual(['child', 'approval']);
  });

  it('reports nothing waiting without queued children or an open approval', () => {
    expect(waitingItems([], 'idle')).toEqual([]);
    expect(waitingItems([runningChild], undefined)).toEqual([]);
  });
});

describe('runningElapsedMs', () => {
  const now = Date.parse('2026-11-25T12:00:05.000Z');

  it('measures from the start timestamp', () => {
    expect(runningElapsedMs('2026-11-25T12:00:00.000Z', now)).toBe(5000);
  });

  it('rejects a missing, unparseable or future start', () => {
    expect(runningElapsedMs(null, now)).toBeNull();
    expect(runningElapsedMs('not-a-date', now)).toBeNull();
    expect(runningElapsedMs('2026-11-25T12:00:10.000Z', now)).toBeNull();
  });
});
