import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedRunner, filterByKind, sortGraphNodes } from './brain-search';
import type { BrainGraphNode } from './graph-layout';

function node(id: string, overrides: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return {
    id,
    kind: 'memory',
    label: id,
    importance: 0.5,
    degree: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('brain search debounce', () => {
  it('coalesces rapid queries and runs only the last one', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const runner = createDebouncedRunner<string>(150, (value) => calls.push(value));

    runner.schedule('a');
    runner.schedule('ab');
    runner.schedule('abc');

    vi.advanceTimersByTime(149);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['abc']);
  });

  it('drops a pending query when cancelled', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const runner = createDebouncedRunner<string>(150, (value) => calls.push(value));

    runner.schedule('emdash');
    runner.cancel();
    vi.advanceTimersByTime(500);

    expect(calls).toEqual([]);
  });

  it('flushes a pending query immediately', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const runner = createDebouncedRunner<string>(150, (value) => calls.push(value));

    runner.schedule('now');
    runner.flush();
    expect(calls).toEqual(['now']);

    // Nothing is left to run twice.
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['now']);
  });
});

describe('brain list filtering', () => {
  it('filters entries by kind and keeps everything when the filter is null', () => {
    const items = [
      node('a', { kind: 'rule' }),
      node('b', { kind: 'preference' }),
      node('c', { kind: 'rule' }),
    ];

    expect(filterByKind(items, null)).toEqual(items);
    expect(filterByKind(items, 'rule').map((item) => item.id)).toEqual(['a', 'c']);
    expect(filterByKind(items, 'identity')).toEqual([]);
    expect(filterByKind(items, null)).not.toBe(items);
  });

  it('orders graph rows by importance, then degree, then id', () => {
    const sorted = sortGraphNodes([
      node('b', { importance: 0.4, degree: 9 }),
      node('c', { importance: 0.9, degree: 0 }),
      node('a', { importance: 0.4, degree: 2 }),
      node('d', { importance: 0.9, degree: 4 }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});
