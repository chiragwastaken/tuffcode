import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THREAD_TITLE,
  deriveTitle,
  isPlaceholderTitle,
  subagentTitle,
} from './titles.js';

describe('deriveTitle', () => {
  it.each([
    ['fix the flaky login test in auth.ts please', 'Fix the flaky login test in auth.ts'],
    ['please fix X', 'Fix X'],
    ['Can you add dark mode to the settings page?', 'Add dark mode to the settings page'],
    ['hey, launch a subagent to test, make it say hi', 'Launch a subagent to test, make it say hi'],
    ['/review src/a.ts', 'Src/a.ts'],
    ['$deploy ship the staging build now. Then tell me.', 'Ship the staging build now'],
    ['see https://example.com/issue/42 for the crash in the runner', 'See for the crash in the runner'],
    ['```ts\nconst a = 1;\n```', null],
    ['`foo()` breaks when the cache is empty', 'Breaks when the cache is empty'],
    ['   \n\t  ', null],
    ['🎉🎉', null],
    ['überprüfe die Übersetzung der Startseite', 'Überprüfe die Übersetzung der Startseite'],
  ])('%j -> %j', (input, expected) => {
    expect(deriveTitle(input)).toBe(expected);
  });

  it('cuts a long sentence at a word boundary under the limit', () => {
    const title = deriveTitle(
      'refactor the provider discovery service so that every adapter reports its models through one normalized path',
    );
    expect(title).not.toBeNull();
    expect(title?.length).toBeLessThanOrEqual(60);
    expect(title).toBe('Refactor the provider discovery service so that every');
  });

  it('keeps only the first line of a multi-line prompt', () => {
    expect(deriveTitle('Investigate the memory leak\n\nIt happens after 2 hours of use.')).toBe(
      'Investigate the memory leak',
    );
  });
});

describe('titles', () => {
  it('treats the default, the legacy id titles and empty text as placeholders', () => {
    expect(isPlaceholderTitle(DEFAULT_THREAD_TITLE)).toBe(true);
    expect(isPlaceholderTitle('Thread 119d3f0a')).toBe(true);
    expect(isPlaceholderTitle('Subagent explorer 4b2c9d1e')).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle('Thread safety review')).toBe(false);
    expect(isPlaceholderTitle('Fix login')).toBe(false);
  });

  it('labels a subagent child by its type and task', () => {
    expect(subagentTitle('explorer', 'map the runner send path and its callers')).toBe(
      'Explorer: Map the runner send path and its callers',
    );
    expect(subagentTitle('worker', '```\n```')).toBe('Worker subagent');
  });
});
