import type { BrainEntry } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import type { BrainGraphEdge, BrainGraphNode } from '../brain/graph-layout';
import {
  BRAIN_KINDS,
  BRAIN_KIND_LABEL,
  BRAIN_RELATIONS,
  CREATABLE_BRAIN_KINDS,
  brainEntryMeta,
  edgesForNode,
  formatTokenCount,
  isBrainRelation,
  isBrainSliceEmpty,
  linkTargetOptions,
  relationLabel,
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

function makeNode(id: string, overrides: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return { id, kind: 'memory', label: id, importance: 0.5, degree: 0, ...overrides };
}

function makeEdge(from: string, to: string, relation = 'about'): BrainGraphEdge {
  return { from, to, relation };
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

  it('summarizes the injected entry count and token cost', () => {
    const slice = { always: [makeEntry()], retrieved: [makeEntry({ id: 'brn_2' })], tokens: 840 };

    expect(summarizeBrainSlice(slice)).toBe('2 entries · 840 tokens');
    expect(summarizeBrainSlice({ always: [], retrieved: [], tokens: 0 })).toBe(
      '0 entries · 0 tokens',
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

describe('brain node links', () => {
  const nodes = [
    makeNode('a', { label: 'Alpha' }),
    makeNode('b', { label: 'Beta' }),
    makeNode('c', { label: 'Gamma' }),
  ];

  it('lists outgoing links with the other endpoint', () => {
    const links = edgesForNode(
      nodes,
      [makeEdge('a', 'b', 'about'), makeEdge('a', 'c', 'caused')],
      'a',
    );

    expect(links.outgoing.map((link) => [link.relation, link.node.id])).toEqual([
      ['about', 'b'],
      ['caused', 'c'],
    ]);
    expect(links.incoming).toEqual([]);
  });

  it('lists incoming links with the other endpoint', () => {
    const links = edgesForNode(nodes, [makeEdge('b', 'a', 'part-of')], 'a');

    expect(links.incoming.map((link) => [link.relation, link.node.id])).toEqual([['part-of', 'b']]);
    expect(links.outgoing).toEqual([]);
  });

  it('splits both directions and keeps a reciprocal edge on each side', () => {
    const links = edgesForNode(
      nodes,
      [makeEdge('a', 'b', 'about'), makeEdge('b', 'a', 'about'), makeEdge('c', 'a', 'supersedes')],
      'a',
    );

    expect(links.outgoing.map((link) => link.node.id)).toEqual(['b']);
    expect(links.incoming.map((link) => link.node.id)).toEqual(['b', 'c']);
  });

  it('skips an edge whose other endpoint is missing from the graph', () => {
    const links = edgesForNode(nodes, [makeEdge('a', 'gone'), makeEdge('a', 'b')], 'a');

    expect(links.outgoing.map((link) => link.node.id)).toEqual(['b']);
    expect(edgesForNode(nodes, [makeEdge('gone', 'a')], 'a')).toEqual({
      incoming: [],
      outgoing: [],
    });
  });

  it('returns empty lists without edges or when no edge touches the node', () => {
    expect(edgesForNode(nodes, [], 'a')).toEqual({ incoming: [], outgoing: [] });
    expect(edgesForNode(nodes, [makeEdge('b', 'c')], 'a')).toEqual({ incoming: [], outgoing: [] });
  });

  it('offers every other node as a labelled, label-ordered link target', () => {
    const options = linkTargetOptions(
      [
        makeNode('a', { label: 'Zeta' }),
        makeNode('b', { label: 'Beta', kind: 'rule' }),
        makeNode('c', { label: 'Alpha', kind: 'preference' }),
      ],
      'a',
    );

    expect(options).toEqual([
      { value: 'c', label: 'Alpha (Preference)' },
      { value: 'b', label: 'Beta (Rule)' },
    ]);
  });

  it('recognizes only the contract relations and labels unknown ones as stored', () => {
    expect(BRAIN_RELATIONS.every(isBrainRelation)).toBe(true);
    expect(isBrainRelation('related-to')).toBe(false);
    expect(BRAIN_RELATIONS.map(relationLabel)).toEqual([
      'about',
      'part of',
      'supersedes',
      'caused',
    ]);
    expect(relationLabel('related-to')).toBe('related-to');
  });
});
