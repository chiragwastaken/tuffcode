import { describe, expect, it } from 'vitest';
import {
  MAX_PANES,
  MIN_PANE_WIDTH_PX,
  addTab,
  availableSurfaces,
  closeLeaf,
  closeTab,
  collapseForNarrow,
  defaultPaneLayout,
  findPane,
  focusPane,
  isPaneSurface,
  leafCount,
  leafNeighbor,
  leafNode,
  leaves,
  leavesOf,
  legacyPaneStorageKey,
  loadPaneLayout,
  moveLeaf,
  moveTab,
  normalizeLayout,
  openSurfaces,
  paneIdOfSurface,
  paneStorageKey,
  paneSurfaceLabel,
  parsePaneLayout,
  resetSplit,
  resizeSplit,
  savePaneLayout,
  selectTab,
  sideThreadId,
  splitLeaf,
  threadSurface,
  type PaneLayout,
  type PaneNode,
  type PaneOrientation,
  type PaneSplit,
  type PaneStorage,
  type PaneSurface,
} from './pane-model';

function leaf(id: string, tabs: PaneSurface[], active?: PaneSurface) {
  return leafNode({ id, tabs, activeTab: active ?? tabs[0]! });
}

function split(
  id: string,
  orientation: PaneOrientation,
  children: [PaneNode, PaneNode],
  sizes: [number, number] = [50, 50],
): PaneSplit {
  return { kind: 'split', id, orientation, children, sizes };
}

function layoutOf(root: PaneNode, focusedPaneId?: string): PaneLayout {
  return {
    version: 2,
    root,
    focusedPaneId: focusedPaneId ?? leavesOf(root)[0]!.id,
  };
}

/** A compact picture of the tree, so nested assertions read like the screen. */
function shape(node: PaneNode): string {
  if (node.kind === 'leaf') return node.pane.tabs.join('|');
  return `${node.orientation === 'horizontal' ? 'H' : 'V'}(${shape(node.children[0])},${shape(node.children[1])})`;
}

function sizesOf(layout: PaneLayout, splitId: string): [number, number] {
  const node = layout.root;
  const found = (function walk(current: PaneNode): PaneSplit | null {
    if (current.kind === 'leaf') return null;
    if (current.id === splitId) return current;
    return walk(current.children[0]) ?? walk(current.children[1]);
  })(node);
  if (found === null) throw new Error(`no split ${splitId}`);
  return found.sizes;
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

describe('pane tree basics', () => {
  it('starts with one thread leaf at full width', () => {
    const layout = defaultPaneLayout();
    expect(layout.version).toBe(2);
    expect(layout.root.kind).toBe('leaf');
    expect(leaves(layout)).toHaveLength(1);
    expect(leaves(layout)[0]?.tabs).toEqual(['thread']);
    expect(layout.focusedPaneId).toBe(leaves(layout)[0]?.id);
    expect(leafCount(layout.root)).toBe(1);
  });

  it('splits in each of the four directions and puts the new leaf on that side', () => {
    const base = defaultPaneLayout();
    const root = leaves(base)[0]!.id;

    const left = splitLeaf(base, root, 'left', 'diff');
    expect(shape(left.root)).toBe('H(diff,thread)');
    expect(left.focusedPaneId).toBe('pane-2');

    const right = splitLeaf(base, root, 'right', 'diff');
    expect(shape(right.root)).toBe('H(thread,diff)');

    const top = splitLeaf(base, root, 'top', 'diff');
    expect(shape(top.root)).toBe('V(diff,thread)');

    const bottom = splitLeaf(base, root, 'bottom', 'diff');
    expect(shape(bottom.root)).toBe('V(thread,diff)');

    // The new split is an even one and it is focused.
    expect(sizesOf(right, 'split-1')).toEqual([50, 50]);
    expect(findPane(right.root, 'pane-2')?.tabs).toEqual(['diff']);
  });

  it('allows nested splits on either axis', () => {
    const two = splitLeaf(defaultPaneLayout(), 'pane-1', 'right', 'diff');
    const nested = splitLeaf(two, 'pane-2', 'bottom', 'terminal');
    expect(shape(nested.root)).toBe('H(thread,V(diff,terminal))');
    expect(leafCount(nested.root)).toBe(3);

    const sideways = splitLeaf(nested, 'pane-2', 'right', 'files');
    expect(shape(sideways.root)).toBe('H(thread,V(H(diff,files),terminal))');
  });

  it('never moves the thread out of its leaf and never duplicates a surface', () => {
    const base = defaultPaneLayout();
    expect(splitLeaf(base, 'pane-1', 'right', 'thread')).toBe(base);

    const two = splitLeaf(base, 'pane-1', 'right', 'diff');
    // Splitting with a surface that is already open focuses its leaf instead.
    const focused = splitLeaf(two, 'pane-1', 'right', 'diff');
    expect(shape(focused.root)).toBe('H(thread,diff)');
    expect(focused.focusedPaneId).toBe('pane-2');
    expect(addTab(two, 'pane-1', 'diff')).toBe(two);
    expect(openSurfaces(two)).toEqual(['thread', 'diff']);
  });

  it('re-roots when the only tab of a leaf is split out of it', () => {
    const two = splitLeaf(defaultPaneLayout(), 'pane-1', 'right', 'diff');
    const third = splitLeaf(two, 'pane-2', 'bottom', 'terminal');
    expect(shape(third.root)).toBe('H(thread,V(diff,terminal))');

    // Splitting a single-tab leaf out of itself re-creates that leaf in place
    // under a new id: the surface is never duplicated and never lost.
    const moved = splitLeaf(third, 'pane-2', 'left', 'diff');
    expect(shape(moved.root)).toBe('H(thread,V(diff,terminal))');
    expect(findPane(moved.root, 'pane-2')).toBeNull();
    expect(leavesOf(moved.root).filter((pane) => pane.tabs.includes('diff'))).toHaveLength(1);

    // A leaf with another tab keeps it and gains a sibling on the requested side.
    const withFiles = splitLeaf(third, 'pane-2', 'right', 'files');
    expect(shape(withFiles.root)).toBe('H(thread,V(H(diff,files),terminal))');
  });

  it('caps the tree at four leaves and folds the drop into the target as a tab', () => {
    const four = normalizeLayout({
      version: 2,
      root: split(
        'split-1',
        'horizontal',
        [
          split('split-2', 'vertical', [leaf('pane-1', ['thread']), leaf('pane-2', ['diff'])]),
          split('split-3', 'vertical', [leaf('pane-3', ['terminal']), leaf('pane-4', ['files'])]),
        ],
      ),
    });
    expect(four).not.toBeNull();
    expect(leafCount(four!.root)).toBe(MAX_PANES);

    const capped = splitLeaf(four!, 'pane-2', 'bottom', 'brain');
    expect(leafCount(capped.root)).toBe(MAX_PANES);
    expect(findPane(capped.root, 'pane-2')?.tabs).toEqual(['diff', 'brain']);
    expect(capped.focusedPaneId).toBe('pane-2');
  });
});

describe('tab and leaf moves', () => {
  it('moves a surface into another leaf at the drop index', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread', 'diff'], 'diff'),
        leaf('pane-2', ['terminal']),
      ]),
    );

    const moved = moveTab(layout, 'pane-1', 'diff', 'pane-2', 0);
    expect(findPane(moved.root, 'pane-1')?.tabs).toEqual(['thread']);
    expect(findPane(moved.root, 'pane-1')?.activeTab).toBe('thread');
    expect(findPane(moved.root, 'pane-2')?.tabs).toEqual(['diff', 'terminal']);
    expect(findPane(moved.root, 'pane-2')?.activeTab).toBe('diff');
    expect(moved.focusedPaneId).toBe('pane-2');
  });

  it('closes the source leaf when its last tab leaves', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [leaf('pane-1', ['thread']), leaf('pane-2', ['terminal'])]),
    );

    const moved = moveTab(layout, 'pane-2', 'terminal', 'pane-1');
    expect(shape(moved.root)).toBe('thread|terminal');
    expect(leafCount(moved.root)).toBe(1);
    expect(findPane(moved.root, 'pane-1')?.activeTab).toBe('terminal');
  });

  it('refuses to move the thread, across the same leaf, or into a leaf that has it', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread', 'diff']),
        leaf('pane-2', ['terminal']),
      ]),
    );

    expect(moveTab(layout, 'pane-1', 'thread', 'pane-2')).toBe(layout);
    expect(moveTab(layout, 'pane-1', 'diff', 'pane-1')).toBe(layout);
    expect(moveTab(layout, 'pane-1', 'diff', 'pane-2')).not.toBe(layout);
    expect(moveTab(layout, 'pane-2', 'terminal', 'pane-1')).not.toBe(layout);
  });

  it('moves a whole leaf beside another one, keeping every tab', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread']),
        split('split-2', 'horizontal', [leaf('pane-2', ['diff', 'files']), leaf('pane-3', ['terminal'])]),
      ]),
    );

    const moved = moveLeaf(layout, 'pane-3', 'pane-1', 'top');
    expect(shape(moved.root)).toBe('H(V(terminal,thread),diff|files)');
    expect(findPane(moved.root, 'pane-3')?.tabs).toEqual(['terminal']);
    expect(moved.focusedPaneId).toBe('pane-3');

    // The route thread's leaf never moves.
    expect(moveLeaf(layout, 'pane-1', 'pane-3', 'right')).toBe(layout);
    expect(moveLeaf(layout, 'pane-2', 'pane-2', 'right')).toBe(layout);
  });

  it('folds a moved leaf into the target as tabs when the tree is full', () => {
    const layout = normalizeLayout({
      version: 2,
      root: split(
        'split-1',
        'horizontal',
        [
          split('split-2', 'vertical', [leaf('pane-1', ['thread']), leaf('pane-2', ['diff'])]),
          split('split-3', 'vertical', [leaf('pane-3', ['terminal']), leaf('pane-4', ['files'])]),
        ],
      ),
    })!;

    const merged = moveLeaf(layout, 'pane-4', 'pane-2', 'right');
    expect(leafCount(merged.root)).toBe(MAX_PANES - 1);
    expect(findPane(merged.root, 'pane-2')?.tabs).toEqual(['diff', 'files']);
    expect(merged.focusedPaneId).toBe('pane-2');
  });
});

describe('closing', () => {
  it('closes a leaf only when it does not host the route thread', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread']),
        split('split-2', 'horizontal', [leaf('pane-2', ['diff']), leaf('pane-3', ['terminal'])]),
      ]),
    );

    expect(closeLeaf(layout, 'pane-1')).toBe(layout);
    const closed = closeLeaf(layout, 'pane-2');
    expect(shape(closed.root)).toBe('H(thread,terminal)');
    expect(leafCount(closed.root)).toBe(2);

    const last = closeLeaf(splitLeaf(defaultPaneLayout(), 'pane-1', 'right', 'diff'), 'pane-2');
    expect(shape(last.root)).toBe('thread');
    expect(last.focusedPaneId).toBe('pane-1');
  });

  it('closes a tab, keeping the thread and closing an emptied leaf', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread', 'diff'], 'diff'),
        leaf('pane-2', ['terminal']),
      ]),
    );

    expect(closeTab(layout, 'pane-1', 'thread')).toBe(layout);
    const closedTab = closeTab(layout, 'pane-1', 'diff');
    expect(findPane(closedTab.root, 'pane-1')?.tabs).toEqual(['thread']);
    expect(findPane(closedTab.root, 'pane-1')?.activeTab).toBe('thread');

    const closedLeaf = closeTab(layout, 'pane-2', 'terminal');
    expect(shape(closedLeaf.root)).toBe('thread|diff');
  });
});

describe('splitter sizing', () => {
  it('drags a splitter with both children clamped to 280px and 70 percent', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [leaf('pane-1', ['thread']), leaf('pane-2', ['diff'])]),
    );

    const widened = resizeSplit(layout, 'split-1', 100, 1006);
    expect(sizesOf(widened, 'split-1').map(Math.round)).toEqual([60, 40]);

    const farRight = resizeSplit(layout, 'split-1', 10_000, 1006);
    expect(sizesOf(farRight, 'split-1').map(Math.round)).toEqual([70, 30]);

    const farLeft = resizeSplit(layout, 'split-1', -10_000, 1006);
    expect(sizesOf(farLeft, 'split-1').map(Math.round)).toEqual([30, 70]);

    const tight = resizeSplit(layout, 'split-1', 400, 400);
    expect(sizesOf(tight, 'split-1')).toEqual([50, 50]);
  });

  it('keeps a nested split independent of the root split', () => {
    const layout = splitLeaf(splitLeaf(defaultPaneLayout(), 'pane-1', 'right', 'diff'), 'pane-2', 'bottom', 'terminal');
    const resized = resizeSplit(layout, 'split-2', 80, 800);
    expect(sizesOf(resized, 'split-1')).toEqual([50, 50]);
    const nested = sizesOf(resized, 'split-2');
    expect(nested[0]).toBeCloseTo(60, 5);
    expect(nested[0] + nested[1]).toBeCloseTo(100, 5);
  });

  it('resets an uneven split back to 50/50 and ignores unknown splits', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [leaf('pane-1', ['thread']), leaf('pane-2', ['diff'])], [65, 35]),
    );
    expect(sizesOf(resetSplit(layout, 'split-1'), 'split-1')).toEqual([50, 50]);
    expect(resetSplit(layout, 'nope')).toBe(layout);
    expect(resizeSplit(layout, 'split-1', 10, 0)).toBe(layout);
    expect(resizeSplit(layout, 'nope', 10, 1000)).toBe(layout);
  });

  it('never lets a child fall below the minimum width in pixels', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [leaf('pane-1', ['thread']), leaf('pane-2', ['diff'])]),
    );
    const squeezed = resizeSplit(layout, 'split-1', -10_000, 1400);
    const [first, second] = sizesOf(squeezed, 'split-1');
    expect((first / 100) * 1400).toBeGreaterThanOrEqual(MIN_PANE_WIDTH_PX - 0.01);
    expect((second / 100) * 1400).toBeGreaterThanOrEqual(MIN_PANE_WIDTH_PX - 0.01);
  });
});

describe('focus moves', () => {
  it('walks to the nearest leaf in each direction', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread']),
        split('split-2', 'vertical', [leaf('pane-2', ['diff']), leaf('pane-3', ['files'])]),
      ]),
    );

    expect(leafNeighbor(layout.root, 'pane-1', 'right')).toBe('pane-2');
    expect(leafNeighbor(layout.root, 'pane-3', 'left')).toBe('pane-1');
    expect(leafNeighbor(layout.root, 'pane-2', 'left')).toBe('pane-1');
    expect(leafNeighbor(layout.root, 'pane-2', 'bottom')).toBe('pane-3');
    expect(leafNeighbor(layout.root, 'pane-3', 'top')).toBe('pane-2');
    expect(leafNeighbor(layout.root, 'pane-1', 'bottom')).toBeNull();
    expect(leafNeighbor(layout.root, 'pane-1', 'left')).toBeNull();
    expect(leafNeighbor(layout.root, 'missing', 'right')).toBeNull();
  });

  it('moves the focused leaf only when it exists', () => {
    const layout = defaultPaneLayout();
    expect(focusPane(layout, 'pane-9')).toBe(layout);
    const two = splitLeaf(layout, 'pane-1', 'right', 'diff');
    expect(focusPane(two, 'pane-1').focusedPaneId).toBe('pane-1');
  });
});

describe('narrow collapse', () => {
  it('keeps one leaf and turns every open surface into a tab', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread'], 'thread'),
        split('split-2', 'horizontal', [leaf('pane-2', ['diff']), leaf('pane-3', ['terminal'])]),
      ]),
    );

    const collapsed = collapseForNarrow(layout);
    expect(leafCount(collapsed.root)).toBe(1);
    expect(leavesOf(collapsed.root)[0]?.id).toBe('pane-1');
    expect(leavesOf(collapsed.root)[0]?.tabs).toEqual(['thread', 'diff', 'terminal']);
    expect(leavesOf(collapsed.root)[0]?.activeTab).toBe('thread');
    // The wide tree is a derived view away from the stored one.
    expect(leafCount(layout.root)).toBe(3);
  });

  it('preserves the first leaf active tab and dedupes surfaces', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread', 'brain'], 'brain'),
        leaf('pane-2', ['diff']),
      ]),
    );

    const collapsed = collapseForNarrow(layout);
    expect(leavesOf(collapsed.root)[0]?.tabs).toEqual(['thread', 'brain', 'diff']);
    expect(leavesOf(collapsed.root)[0]?.activeTab).toBe('brain');
  });
});

describe('layout repair', () => {
  it('migrates a version 1 row into a horizontal chain with its widths', () => {
    const legacy = {
      version: 1,
      panes: [
        { id: 'pane-1', tabs: ['thread'], activeTab: 'thread', width: 50 },
        { id: 'pane-2', tabs: ['diff'], activeTab: 'diff', width: 30 },
        { id: 'pane-3', tabs: ['terminal'], activeTab: 'terminal', width: 20 },
      ],
    };

    const migrated = normalizeLayout(legacy);
    expect(migrated).not.toBeNull();
    expect(shape(migrated!.root)).toBe('H(thread,H(diff,terminal))');
    expect(sizesOf(migrated!, 'split-1').map(Math.round)).toEqual([50, 50]);
    expect(sizesOf(migrated!, 'split-2').map(Math.round)).toEqual([60, 40]);
    expect(migrated!.focusedPaneId).toBe('pane-1');

    const single = normalizeLayout({ version: 1, panes: [{ tabs: ['thread'] }] });
    expect(shape(single!.root)).toBe('thread');
  });

  it('moves the thread into the first leaf whatever the stored order', () => {
    const repaired = normalizeLayout({
      version: 2,
      root: split('split-1', 'horizontal', [
        leaf('pane-1', ['diff']),
        leaf('pane-2', ['thread', 'terminal'], 'thread'),
      ]),
    });

    expect(repaired).not.toBeNull();
    expect(shape(repaired!.root)).toBe('H(thread|diff,terminal)');
    expect(leavesOf(repaired!.root)[1]?.activeTab).toBe('terminal');
  });

  it('drops duplicate surfaces and empty leaves', () => {
    const repaired = normalizeLayout({
      version: 2,
      root: split('split-1', 'horizontal', [
        split('split-2', 'vertical', [leaf('pane-1', ['thread', 'diff']), leaf('pane-2', ['diff'])]),
        leaf('pane-3', ['terminal', 'diff']),
      ]),
    });

    expect(repaired).not.toBeNull();
    expect(shape(repaired!.root)).toBe('H(thread|diff,terminal)');
    expect(openSurfaces(repaired!)).toEqual(['thread', 'diff', 'terminal']);
  });

  it('collapses one-child splits and renormalizes invalid sizes', () => {
    const repaired = normalizeLayout({
      version: 2,
      root: split('split-1', 'horizontal', [
        leaf('pane-1', ['thread']),
        split('split-2', 'horizontal', [leaf('pane-2', ['diff'])] as unknown as [PaneNode, PaneNode], [10, 0]),
      ] as unknown as [PaneNode, PaneNode]),
    });

    expect(repaired).not.toBeNull();
    // The one-child split collapses into its parent; the invalid sizes of the
    // surviving split fall back to an even one.
    expect(shape(repaired!.root)).toBe('H(thread,diff)');
    expect(sizesOf(repaired!, 'split-1')).toEqual([50, 50]);
  });

  it('keeps only four leaves and folds the rest into the last kept leaf', () => {
    const repaired = normalizeLayout({
      version: 2,
      root: split('split-1', 'horizontal', [
        split('split-2', 'horizontal', [
          split('split-3', 'vertical', [leaf('pane-1', ['thread']), leaf('pane-2', ['diff'])]),
          split('split-4', 'vertical', [leaf('pane-3', ['terminal']), leaf('pane-4', ['files'])]),
        ]),
        leaf('pane-5', ['brain']),
      ]),
    });

    expect(repaired).not.toBeNull();
    expect(leafCount(repaired!.root)).toBe(MAX_PANES);
    expect(openSurfaces(repaired!)).toContain('brain');
    expect(findPane(repaired!.root, 'pane-4')?.tabs).toEqual(['files', 'brain']);
  });

  it('falls back to the first leaf for a missing or unknown focused pane', () => {
    const base = { version: 2, root: leaf('pane-1', ['thread']) };
    expect(normalizeLayout(base)?.focusedPaneId).toBe('pane-1');
    expect(normalizeLayout({ ...base, focusedPaneId: 'pane-9' })?.focusedPaneId).toBe('pane-1');
  });

  it('rejects garbage', () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout({})).toBeNull();
    expect(normalizeLayout({ panes: [] })).toBeNull();
    expect(normalizeLayout({ version: 2, root: { kind: 'leaf' } })).toBeNull();
    expect(parsePaneLayout(null)).toBeNull();
    expect(parsePaneLayout('{"version":2}')).toBeNull();
    expect(parsePaneLayout('{not json')).toBeNull();
    expect(parsePaneLayout(JSON.stringify({ version: 0, panes: [{ tabs: ['diff'] }] }))).toBeNull();
  });
});

describe('pane persistence', () => {
  it('round-trips a nested tree through the version 2 key', () => {
    const storage = memoryStorage();
    const layout = resizeSplit(
      splitLeaf(splitLeaf(defaultPaneLayout(), 'pane-1', 'right', 'diff'), 'pane-2', 'bottom', 'terminal'),
      'split-1',
      80,
      1000,
    );

    savePaneLayout('thr_a', layout, storage);
    expect(storage.entries[paneStorageKey('thr_a')]).toContain('"version":2');
    expect(loadPaneLayout('thr_a', storage)).toEqual(layout);
  });

  it('reads a version 1 entry when no version 2 layout exists', () => {
    const storage = memoryStorage({
      [legacyPaneStorageKey('thr_a')]: JSON.stringify({
        version: 1,
        panes: [
          { id: 'pane-1', tabs: ['thread'], activeTab: 'thread', width: 50 },
          { id: 'pane-2', tabs: ['terminal'], activeTab: 'terminal', width: 50 },
        ],
      }),
    });

    expect(shape(loadPaneLayout('thr_a', storage).root)).toBe('H(thread,terminal)');

    // A version 2 layout wins over the stale version 1 entry.
    const newer = splitLeaf(defaultPaneLayout(), 'pane-1', 'bottom', 'diff');
    savePaneLayout('thr_a', newer, storage);
    expect(shape(loadPaneLayout('thr_a', storage).root)).toBe('V(thread,diff)');
  });

  it('keeps layouts per thread and falls back to the default', () => {
    const storage = memoryStorage();
    savePaneLayout('thr_a', splitLeaf(defaultPaneLayout(), 'pane-1', 'right', 'terminal'), storage);

    expect(loadPaneLayout('thr_b', storage)).toEqual(defaultPaneLayout());
    expect(shape(loadPaneLayout('thr_a', storage).root)).toBe('H(thread,terminal)');
  });

  it('survives a storage that throws', () => {
    const hostile: PaneStorage = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('blocked');
      },
    };
    expect(loadPaneLayout('thr_a', hostile)).toEqual(defaultPaneLayout());
    expect(() => savePaneLayout('thr_a', defaultPaneLayout(), hostile)).not.toThrow();
  });
});

describe('side chats', () => {
  it('opens another chat beside the thread and labels it by title', () => {
    const surface = threadSurface('thr_other');
    expect(isPaneSurface(surface)).toBe(true);
    expect(isPaneSurface('thread:../../etc')).toBe(false);
    expect(sideThreadId(surface)).toBe('thr_other');
    expect(sideThreadId('diff')).toBeNull();

    const layout = splitLeaf(defaultPaneLayout(), 'pane-1', 'right', surface);
    expect(findPane(layout.root, 'pane-2')?.tabs).toEqual([surface]);
    expect(paneIdOfSurface(layout, surface)).toBe('pane-2');
    expect(paneSurfaceLabel(surface, (id) => (id === 'thr_other' ? 'Fix login' : undefined))).toBe(
      'Fix login',
    );
    expect(paneSurfaceLabel('files')).toBe('Files');

    const restored = normalizeLayout({
      version: 2,
      root: split('split-1', 'horizontal', [leaf('pane-1', ['thread']), leaf('pane-2', [surface])]),
    });
    expect(findPane(restored!.root, 'pane-2')?.tabs).toEqual([surface]);
    expect(availableSurfaces(layout)).not.toContain(surface);
  });

  it('selects a tab and focuses its leaf', () => {
    const layout = layoutOf(
      split('split-1', 'horizontal', [
        leaf('pane-1', ['thread', 'diff']),
        leaf('pane-2', ['terminal']),
      ]),
    );
    expect(selectTab(layout, 'pane-1', 'thread')).toBe(layout);
    expect(selectTab(layout, 'pane-2', 'terminal').focusedPaneId).toBe('pane-2');
    const moved = selectTab(layout, 'pane-1', 'diff');
    expect(findPane(moved.root, 'pane-1')?.activeTab).toBe('diff');
    expect(moved.focusedPaneId).toBe('pane-1');
  });
});
