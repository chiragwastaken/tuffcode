import { describe, expect, it } from 'vitest';
import { filterPalette, parseTrigger, triggerInsert } from './slash';

describe('parseTrigger', () => {
  it('matches a leading slash command and its query', () => {
    expect(parseTrigger('/')).toEqual({ kind: 'command', query: '' });
    expect(parseTrigger('/review')).toEqual({ kind: 'command', query: 'review' });
    expect(parseTrigger('/pr-2')).toEqual({ kind: 'command', query: 'pr-2' });
  });

  it('matches a leading dollar skill', () => {
    expect(parseTrigger('$')).toEqual({ kind: 'skill', query: '' });
    expect(parseTrigger('$commit')).toEqual({ kind: 'skill', query: 'commit' });
  });

  it('ignores triggers that are not the leading token', () => {
    expect(parseTrigger('hello')).toBeNull();
    expect(parseTrigger(' /review')).toBeNull();
    expect(parseTrigger('please /review')).toBeNull();
    expect(parseTrigger('/review now')).toBeNull();
    expect(parseTrigger('/review ')).toBeNull();
    expect(parseTrigger('$skill extra')).toBeNull();
  });
});

describe('triggerInsert', () => {
  it('writes the trigger with a trailing space', () => {
    expect(triggerInsert('command', 'review')).toBe('/review ');
    expect(triggerInsert('skill', 'commit')).toBe('$commit ');
  });
});

describe('filterPalette', () => {
  const entries = [
    { name: 'review', description: 'Review the diff' },
    { name: 'pr', description: 'Open a pull request' },
    { name: 'preview', description: 'Preview the app' },
    { name: 'test', description: 'Run tests' },
  ];

  it('returns everything for an empty query, alphabetically', () => {
    expect(filterPalette(entries, '').map((entry) => entry.name)).toEqual([
      'pr',
      'preview',
      'review',
      'test',
    ]);
  });

  it('puts prefix matches ahead of substring matches', () => {
    expect(filterPalette(entries, 'pr').map((entry) => entry.name)).toEqual(['pr', 'preview']);
    expect(filterPalette(entries, 'rev').map((entry) => entry.name)).toEqual(['review', 'preview']);
  });

  it('respects the limit and returns nothing when no name matches', () => {
    expect(filterPalette(entries, '', 2).map((entry) => entry.name)).toEqual(['pr', 'preview']);
    expect(filterPalette(entries, 'zzz')).toEqual([]);
  });
});
