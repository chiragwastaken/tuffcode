import { describe, expect, it } from 'vitest';
import {
  MAX_PANES,
  MIN_PANE_WIDTH_PX,
  addPane,
  addTab,
  availableSurfaces,
  clampLayoutWidths,
  clampPaneWidth,
  clampPaneWidths,
  closePane,
  closeTab,
  collapseToSinglePane,
  defaultPaneLayout,
  loadPaneLayout,
  moveTab,
  normalizePaneLayout,
  paneIdOfSurface,
  parsePaneLayout,
  resetSplit,
  resizeSplit,
  savePaneLayout,
  selectTab,
  type PaneLayout,
  type PaneStorage,
  type PaneSurface,
} from './pane-model';

interface PaneSpec {
  id: string;
  tabs: PaneSurface[];
  active?: PaneSurface;
  width?: number;
}

function layoutOf(...specs: PaneSpec[]): PaneLayout {
  return {
    panes: specs.map((spec) => ({
      id: spec.id,
      tabs: spec.tabs,
      activeTab: spec.active ?? spec.tabs[0]!,
      width: spec.width ?? 100 / specs.length,
    })),
  };
}

function memoryStorage(entries: Record<string, string> = {}): PaneStorage & {
  entries: Record<string, string>;
} {
  const store = {
    entries: { ...entries },
    getItem(key: string): string | null {
      return store.entries[key] ?? null;
    },
    setItem(key: string, value: string): void {
      store.entries[key] = value;
    },
  };
  return store;
}

function widths(layout: PaneLayout): number[] {
  return layout.panes.map((pane) => pane.width);
}

describe('pane add and close', () => {
  it('starts with one thread pane at full width', () => {
    const layout = defaultPaneLayout();
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0]?.tabs).toEqual(['thread']);
    expect(layout.panes[0]?.activeTab).toBe('thread');
    expect(layout.panes[0]?.width).toBe(100);
  });

  it('splits into equal halves, then equal thirds, up to three panes', () => {
    const two = addPane(defaultPaneLayout(), 'diff');
    expect(two.panes).toHaveLength(2);
    expect(widths(two).map((width) => Math.round(width))).toEqual([50, 50]);
    expect(two.panes[1]?.tabs).toEqual(['diff']);

    const three = addPane(two, 'terminal');
    expect(three.panes).toHaveLength(3);
    expect(widths(three).map((width) => Math.round(width))).toEqual([33, 33, 33]);
    expect(widths(three).reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);

    const fourth = addPane(three, 'brain');
    expect(fourth).toBe(three);
    expect(three.panes).toHaveLength(MAX_PANES);
  });

  it('never moves the thread out of the first pane and never duplicates a surface', () => {
    const layout = addPane(defaultPaneLayout(), 'diff');
    expect(addPane(layout, 'thread')).toBe(layout);
    expect(addPane(layout, 'diff')).toBe(layout);
    expect(addTab(layout, layout.panes[0]!.id, 'thread')).toBe(layout);
    expect(addTab(layout, layout.panes[0]!.id, 'diff')).toBe(layout);
  });

  it('closes a pane only after the first and renormalizes the widths', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread'], width: 40 },
      { id: 'pane-2', tabs: ['diff'], width: 30 },
      { id: 'pane-3', tabs: ['terminal'], width: 30 },
    );

    expect(closePane(layout, 'pane-1')).toBe(layout);
    const closed = closePane(layout, 'pane-2');
    expect(closed.panes.map((pane) => pane.id)).toEqual(['pane-1', 'pane-3']);
    expect(widths(closed)[0]).toBeCloseTo(57.14, 2);
    expect(widths(closed)[1]).toBeCloseTo(42.86, 2);
    expect(widths(closed).reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);

    const last = closePane(addPane(defaultPaneLayout(), 'diff'), 'pane-2');
    expect(last.panes).toHaveLength(1);
    expect(last.panes[0]?.width).toBe(100);
  });

  it('closes a tab, keeping the thread and closing an emptied pane', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread', 'diff'], active: 'diff' },
      { id: 'pane-2', tabs: ['terminal'] },
    );

    expect(closeTab(layout, 'pane-1', 'thread')).toBe(layout);
    const closedTab = closeTab(layout, 'pane-1', 'diff');
    expect(closedTab.panes[0]?.tabs).toEqual(['thread']);
    expect(closedTab.panes[0]?.activeTab).toBe('thread');

    const closedPane = closeTab(layout, 'pane-2', 'terminal');
    expect(closedPane.panes).toHaveLength(1);
    expect(closedPane.panes[0]?.width).toBe(100);
  });

  it('selects a tab and reports which pane owns a surface', () => {
    const layout = addPane(addPane(defaultPaneLayout(), 'diff'), 'terminal');
    expect(paneIdOfSurface(layout, 'terminal')).toBe('pane-3');
    expect(paneIdOfSurface(layout, 'brain')).toBeNull();

    const selected = selectTab(layout, 'pane-2', 'diff');
    expect(selected).toBe(layout);
    expect(availableSurfaces(layout)).toEqual(['brain', 'council', 'subagent']);
  });
});

describe('pane width clamp', () => {
  it('clamps a single width between 280px and 70 percent', () => {
    expect(clampPaneWidth(100, 1000)).toBe(MIN_PANE_WIDTH_PX);
    expect(clampPaneWidth(500, 1000)).toBe(500);
    expect(clampPaneWidth(900, 1000)).toBe(700);
    expect(clampPaneWidth(900, 100)).toBe(100);
  });

  it('clamps percentage widths against the row and keeps them at 100', () => {
    const clamped = clampPaneWidths([95, 5], 1000);
    const available = 994;
    expect(clamped.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);
    expect((clamped[0]! / 100) * available).toBeLessThanOrEqual(700 + 0.001);
    expect((clamped[1]! / 100) * available).toBeGreaterThanOrEqual(MIN_PANE_WIDTH_PX - 0.001);

    expect(clampPaneWidths([50, 50], 1000)).toEqual([50, 50]);
  });

  it('leaves an in-bounds layout untouched', () => {
    const layout = addPane(defaultPaneLayout(), 'diff');
    expect(clampLayoutWidths(layout, 1200)).toBe(layout);
  });

  it('gives a single pane the whole row', () => {
    expect(clampPaneWidths([100], 1184)).toEqual([100]);
    const single = layoutOf({ id: 'pane-1', tabs: ['thread'], width: 70 });
    expect(clampLayoutWidths(single, 1184).panes[0]?.width).toBe(100);
  });

  it('drags a splitter with both panes clamped', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread'], width: 50 },
      { id: 'pane-2', tabs: ['diff'], width: 50 },
    );

    const widened = resizeSplit(layout, 0, 100, 1006);
    expect(widths(widened).map(Math.round)).toEqual([60, 40]);

    const farRight = resizeSplit(layout, 0, 10_000, 1006);
    expect(widths(farRight).map(Math.round)).toEqual([70, 30]);

    const farLeft = resizeSplit(layout, 0, -10_000, 1006);
    expect(widths(farLeft).map(Math.round)).toEqual([30, 70]);
    expect(widths(farLeft).reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);

    expect(resizeSplit(layout, 3, 100, 1006)).toBe(layout);
  });

  it('resets an uneven split back to 50/50', () => {
    const uneven = resizeSplit(
      layoutOf(
        { id: 'pane-1', tabs: ['thread'], width: 50 },
        { id: 'pane-2', tabs: ['diff'], width: 50 },
      ),
      0,
      120,
      1006,
    );
    expect(widths(resetSplit(uneven, 0)).map(Math.round)).toEqual([50, 50]);
  });
});

describe('tab move', () => {
  it('moves a surface into another pane at the drop index', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread', 'diff'], active: 'diff' },
      { id: 'pane-2', tabs: ['terminal'] },
    );

    const moved = moveTab(layout, 'pane-1', 'diff', 'pane-2', 0);
    expect(moved.panes[0]?.tabs).toEqual(['thread']);
    expect(moved.panes[0]?.activeTab).toBe('thread');
    expect(moved.panes[1]?.tabs).toEqual(['diff', 'terminal']);
    expect(moved.panes[1]?.activeTab).toBe('diff');
    expect(moved.panes).toHaveLength(2);
  });

  it('closes the source pane when its last tab leaves', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread'], width: 40 },
      { id: 'pane-2', tabs: ['terminal'], width: 60 },
    );

    const moved = moveTab(layout, 'pane-2', 'terminal', 'pane-1');
    expect(moved.panes).toHaveLength(1);
    expect(moved.panes[0]?.tabs).toEqual(['thread', 'terminal']);
    expect(moved.panes[0]?.width).toBe(100);
    expect(moved.panes[0]?.activeTab).toBe('terminal');
  });

  it('refuses to move the thread, across the same pane, or into a pane that has it', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread', 'diff'] },
      { id: 'pane-2', tabs: ['terminal'] },
    );

    expect(moveTab(layout, 'pane-1', 'thread', 'pane-2')).toBe(layout);
    expect(moveTab(layout, 'pane-1', 'diff', 'pane-1')).toBe(layout);
    expect(moveTab(layout, 'pane-1', 'diff', 'pane-2')).not.toBe(layout);
    expect(moveTab(layout, 'pane-2', 'terminal', 'pane-1')).not.toBe(layout);
  });
});

describe('narrow collapse', () => {
  it('keeps one pane and turns every open surface into a tab', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread'], active: 'thread', width: 34 },
      { id: 'pane-2', tabs: ['diff'], width: 33 },
      { id: 'pane-3', tabs: ['terminal'], width: 33 },
    );

    const collapsed = collapseToSinglePane(layout);
    expect(collapsed.panes).toHaveLength(1);
    expect(collapsed.panes[0]?.id).toBe('pane-1');
    expect(collapsed.panes[0]?.tabs).toEqual(['thread', 'diff', 'terminal']);
    expect(collapsed.panes[0]?.activeTab).toBe('thread');
    expect(collapsed.panes[0]?.width).toBe(100);
    // The wide layout is a derived view away from the stored one.
    expect(layout.panes).toHaveLength(3);
  });

  it('preserves the active tab of the first pane and dedupes surfaces', () => {
    const layout = layoutOf(
      { id: 'pane-1', tabs: ['thread', 'brain'], active: 'brain' },
      { id: 'pane-2', tabs: ['diff'] },
    );

    const collapsed = collapseToSinglePane(layout);
    expect(collapsed.panes[0]?.tabs).toEqual(['thread', 'brain', 'diff']);
    expect(collapsed.panes[0]?.activeTab).toBe('brain');
  });
});

describe('pane persistence', () => {
  it('round-trips a two-pane layout through storage', () => {
    const storage = memoryStorage();
    const layout = addPane(defaultPaneLayout(), 'diff');
    layout.panes[0]!.width = 62;
    layout.panes[1]!.width = 38;

    savePaneLayout('thr_a', layout, storage);
    const loaded = loadPaneLayout('thr_a', storage);

    expect(loaded).toEqual(layout);
  });

  it('keeps layouts per thread and falls back to the default', () => {
    const storage = memoryStorage();
    savePaneLayout('thr_a', addPane(defaultPaneLayout(), 'terminal'), storage);

    expect(loadPaneLayout('thr_b', storage)).toEqual(defaultPaneLayout());
    expect(loadPaneLayout('thr_a', storage).panes[1]?.tabs).toEqual(['terminal']);
  });

  it('ignores corrupt or version-mismatched entries', () => {
    const corrupt = memoryStorage({ 'tuffcode.panes.v1.thr_a': '{not json' });
    expect(loadPaneLayout('thr_a', corrupt)).toEqual(defaultPaneLayout());

    const oldVersion = memoryStorage({
      'tuffcode.panes.v1.thr_a': JSON.stringify({ version: 0, panes: [{ tabs: ['diff'] }] }),
    });
    expect(loadPaneLayout('thr_a', oldVersion)).toEqual(defaultPaneLayout());

    expect(parsePaneLayout(null)).toBeNull();
    expect(parsePaneLayout('{"version":1}')).toBeNull();
  });

  it('repairs a stored layout: thread first, unique surfaces, widths summing to 100', () => {
    const repaired = normalizePaneLayout({
      panes: [
        { id: 'pane-1', tabs: ['diff', 'diff'], activeTab: 'brain', width: 10 },
        { id: 'pane-2', tabs: ['thread'], activeTab: 'thread', width: 10 },
        { id: 'pane-3', tabs: ['brain'], width: 10 },
      ],
    });

    expect(repaired).not.toBeNull();
    expect(repaired?.panes).toHaveLength(2);
    expect(repaired?.panes[0]?.tabs).toEqual(['thread', 'diff']);
    expect(repaired?.panes[0]?.activeTab).toBe('thread');
    expect(repaired?.panes[1]?.tabs).toEqual(['brain']);
    expect(repaired?.panes.map((pane) => pane.width)).toEqual([50, 50]);

    const capped = normalizePaneLayout({
      panes: [
        { tabs: ['thread'] },
        { tabs: ['diff'] },
        { tabs: ['terminal'] },
        { tabs: ['brain'] },
      ],
    });
    expect(capped?.panes).toHaveLength(3);
    expect(capped?.panes[0]?.tabs).toEqual(['thread']);

    expect(normalizePaneLayout({ panes: [] })).toBeNull();
    expect(normalizePaneLayout(null)).toBeNull();
  });
});
