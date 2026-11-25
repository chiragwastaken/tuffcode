import type { PromptPreview } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { injectionRows } from './context-model';

function makePreview(overrides: Partial<PromptPreview> = {}): PromptPreview {
  return { sections: [], total: 0, ...overrides };
}

describe('injectionRows', () => {
  it('lists injected ids with their reasons in injection order', () => {
    const preview = makePreview({
      injectedIds: ['brn_rule', 'brn_memory'],
      injectionReasons: {
        brn_rule: 'standing rule for every turn',
        brn_memory: 'recalled for this message',
      },
    });

    expect(injectionRows(preview)).toEqual({
      count: 2,
      rows: [
        { id: 'brn_rule', reason: 'standing rule for every turn' },
        { id: 'brn_memory', reason: 'recalled for this message' },
      ],
    });
  });

  it('fills a placeholder for ids the server did not explain', () => {
    const preview = makePreview({
      injectedIds: ['brn_rule', 'brn_memory'],
      injectionReasons: { brn_memory: 'recalled for this message' },
    });

    expect(injectionRows(preview)).toEqual({
      count: 2,
      rows: [
        { id: 'brn_rule', reason: 'no reason recorded' },
        { id: 'brn_memory', reason: 'recalled for this message' },
      ],
    });
  });

  it('reports nothing for a preview without injection ids', () => {
    expect(injectionRows(makePreview())).toEqual({ count: 0, rows: [] });
  });

  it('reports nothing for a preview with an empty id list', () => {
    expect(injectionRows(makePreview({ injectedIds: [], injectionReasons: {} }))).toEqual({
      count: 0,
      rows: [],
    });
  });
});
