import type { BrainEntry } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  BRAIN_KINDS,
  BRAIN_KIND_LABEL,
  CREATABLE_BRAIN_KINDS,
  brainEntryMeta,
  formatTokenCount,
  isBrainSliceEmpty,
  sortBrainEntries,
  summarizeBrainSlice,
  toggleBrainEntryParams,
} from './brain-model';

function makeEntry(overrides: Partial<BrainEntry> = {}): BrainEntry {
  return {
    id: 'brn_1',
    kind: 'rule',
    scope: 'global',
    projectId: null,
    text: 'Never use npm',
    tags: '',
    appliesTo: null,
    importance: 0.5,
    useCount: 0,
    active: true,
    sourceQuote: null,
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}

describe('brain preview formatting', () => {
  it('labels token counts with singular and plural units', () => {
    expect(formatTokenCount(0)).toBe('0 tokens');
    expect(formatTokenCount(1)).toBe('1 token');
    expect(formatTokenCount(1200)).toBe('1,200 tokens');
  });

  it('clamps nonsense token counts instead of rendering NaN', () => {
    expect(formatTokenCount(-5)).toBe('0 tokens');
    expect(formatTokenCount(Number.NaN)).toBe('0 tokens');
  });

  it('summarizes the always, retrieved and token counts', () => {
    const slice = { always: [makeEntry()], retrieved: [makeEntry({ id: 'brn_2' })], tokens: 840 };

    expect(summarizeBrainSlice(slice)).toBe('1 always, 1 retrieved, 840 tokens');
    expect(summarizeBrainSlice({ always: [], retrieved: [], tokens: 0 })).toBe(
      '0 always, 0 retrieved, 0 tokens',
    );
  });

  it('detects an empty injection', () => {
    expect(isBrainSliceEmpty({ always: [], retrieved: [], tokens: 0 })).toBe(true);
    expect(isBrainSliceEmpty({ always: [makeEntry()], retrieved: [], tokens: 12 })).toBe(false);
  });
});

describe('brain entry helpers', () => {
  it('sorts active entries first, then newest first', () => {
    const sorted = sortBrainEntries([
      makeEntry({ id: 'brn_old', updatedAt: '2026-11-20T10:00:00.000Z' }),
      makeEntry({ id: 'brn_new', updatedAt: '2026-11-24T10:00:00.000Z' }),
      makeEntry({ id: 'brn_off', active: false, updatedAt: '2026-11-25T10:00:00.000Z' }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['brn_new', 'brn_old', 'brn_off']);
  });

  it('describes scope, applies-to, tags and importance', () => {
    expect(brainEntryMeta(makeEntry())).toBe('global | importance 0.50');
    expect(
      brainEntryMeta(
        makeEntry({ scope: 'prj_1', appliesTo: 'plan', tags: 'style', importance: 0.9 }),
      ),
    ).toBe('prj_1 | plan | style | importance 0.90');
  });

  it('sends every contract field when toggling active', () => {
    const entry = makeEntry({
      id: 'brn_9',
      kind: 'project',
      scope: 'project',
      projectId: 'prj_1',
      text: 'Electron plus React',
      tags: 'stack',
      appliesTo: 'all',
      importance: 0.8,
    });

    expect(toggleBrainEntryParams(entry)).toEqual({
      id: 'brn_9',
      kind: 'project',
      scope: 'project',
      projectId: 'prj_1',
      text: 'Electron plus React',
      tags: 'stack',
      appliesTo: 'all',
      importance: 0.8,
      active: false,
    });

    expect(toggleBrainEntryParams({ ...entry, active: false }).active).toBe(true);
  });

  it('omits a null appliesTo rather than sending null', () => {
    expect(toggleBrainEntryParams(makeEntry({ appliesTo: null }))).not.toHaveProperty('appliesTo');
  });

  it('labels every kind and only offers hand-written kinds for creation', () => {
    expect(BRAIN_KINDS.map((kind) => BRAIN_KIND_LABEL[kind])).toEqual([
      'Identity',
      'Preference',
      'Rule',
      'Project',
      'Memory',
      'Working note',
    ]);
    expect(CREATABLE_BRAIN_KINDS).toEqual(['rule', 'preference']);
  });
});
