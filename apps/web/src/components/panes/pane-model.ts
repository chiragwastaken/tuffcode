/**
 * Split-pane layout for the main area: one to four panes, each with a strip of
 * surfaces and a width. The first pane always hosts the route's thread; other panes
 * may host another chat (`thread:<id>`, a side chat) or a tool surface.
 *
 * Everything here is pure, so the split, collapse and persistence rules are
 * testable without a DOM. Widths are percentages of the row's available width
 * (splitters excluded); the pixel clamp lives in `resizeSplit` and
 * `clampLayoutWidths`.
 */

export const PANE_SURFACES = [
  'thread',
  'diff',
  'files',
  'terminal',
  'browser',
  'brain',
  'council',
  'subagent',
] as const;

export type FixedPaneSurface = (typeof PANE_SURFACES)[number];

/** A fixed tool surface, or another chat opened beside the route's thread. */
export type PaneSurface = FixedPaneSurface | `thread:${string}`;

export const PANE_SURFACE_LABEL: Record<FixedPaneSurface, string> = {
  thread: 'Thread',
  diff: 'Diff',
  files: 'Files',
  terminal: 'Terminal',
  browser: 'Browser',
  brain: 'Brain',
  council: 'Council',
  subagent: 'Subagent',
};

const SIDE_THREAD = /^thread:[A-Za-z0-9_-]{1,80}$/;

export function threadSurface(threadId: string): PaneSurface {
  return `thread:${threadId}`;
}

/** The thread id of a side-chat surface, or null for a fixed surface. */
export function sideThreadId(surface: PaneSurface): string | null {
  return surface.startsWith('thread:') ? surface.slice('thread:'.length) : null;
}

export function paneSurfaceLabel(
  surface: PaneSurface,
  titleOf: (threadId: string) => string | undefined = () => undefined,
): string {
  const side = sideThreadId(surface);
  if (side === null) return PANE_SURFACE_LABEL[surface as FixedPaneSurface];
  return titleOf(side) ?? 'Chat';
}

export const MAX_PANES = 4;
export const MIN_PANE_WIDTH_PX = 280;
export const MAX_PANE_WIDTH_RATIO = 0.7;
export const SPLITTER_WIDTH_PX = 6;
/** Below this row width the panes collapse into one pane with tabs. */
export const NARROW_PANE_WIDTH_PX = 1100;

export interface PaneLayoutPane {
  id: string;
  /** Surfaces open in this pane; the thread surface belongs to the first pane. */
  tabs: PaneSurface[];
  activeTab: PaneSurface;
  /** Percentage of the row's available width. Panes sum to 100. */
  width: number;
}

export interface PaneLayout {
  panes: PaneLayoutPane[];
}

const FIRST_PANE_ID = 'pane-1';
const STORAGE_VERSION = 1;

export function isPaneSurface(value: unknown): value is PaneSurface {
  return (
    typeof value === 'string' &&
    ((PANE_SURFACES as readonly string[]).includes(value) || SIDE_THREAD.test(value))
  );
}

export function defaultPaneLayout(): PaneLayout {
  return { panes: [{ id: FIRST_PANE_ID, tabs: ['thread'], activeTab: 'thread', width: 100 }] };
}

export function paneHasSurface(layout: PaneLayout, surface: PaneSurface): boolean {
  return layout.panes.some((pane) => pane.tabs.includes(surface));
}

export function paneIdOfSurface(layout: PaneLayout, surface: PaneSurface): string | null {
  return layout.panes.find((pane) => pane.tabs.includes(surface))?.id ?? null;
}

/** Surfaces that are not open anywhere; the thread is never offered. */
export function availableSurfaces(layout: PaneLayout): PaneSurface[] {
  return PANE_SURFACES.filter(
    (surface) => surface !== 'thread' && !paneHasSurface(layout, surface),
  );
}

export function paneAvailableWidth(containerPx: number, paneCount: number): number {
  return Math.max(0, containerPx - SPLITTER_WIDTH_PX * Math.max(0, paneCount - 1));
}

/** A single pane width in pixels, clamped to 280px and 70% of the row. */
export function clampPaneWidth(widthPx: number, containerPx: number): number {
  const min = Math.min(MIN_PANE_WIDTH_PX, containerPx);
  const max = Math.max(min, containerPx * MAX_PANE_WIDTH_RATIO);
  return Math.min(Math.max(widthPx, min), max);
}

/**
 * Re-clamps percentage widths against a pixel row. Panes never drop below 280px
 * or above 70 percent; slack moves to panes that still have headroom, so the
 * result always fills the row.
 */
export function clampPaneWidths(widths: readonly number[], containerPx: number): number[] {
  if (widths.length === 0) return [];
  // One pane owns the row; the 70 percent ceiling only applies to splits.
  if (widths.length === 1) return [100];
  const available = paneAvailableWidth(containerPx, widths.length);
  if (available <= 0) return [...widths];

  const min = Math.min(MIN_PANE_WIDTH_PX, available / widths.length);
  const max = Math.max(min, available * MAX_PANE_WIDTH_RATIO);
  const pixels = widths.map((width) => Math.min(Math.max((available * width) / 100, min), max));
  const total = pixels.reduce((sum, value) => sum + value, 0);

  if (total < available) {
    const headroom = pixels.map((value) => max - value);
    const capacity = headroom.reduce((sum, value) => sum + value, 0);
    if (capacity > 0) {
      const growth = Math.min(available - total, capacity);
      for (let index = 0; index < pixels.length; index += 1) {
        pixels[index] = (pixels[index] ?? 0) + ((headroom[index] ?? 0) / capacity) * growth;
      }
    }
  } else if (total > available) {
    const slack = pixels.map((value) => value - min);
    const capacity = slack.reduce((sum, value) => sum + value, 0);
    if (capacity > 0) {
      const shrink = Math.min(total - available, capacity);
      for (let index = 0; index < pixels.length; index += 1) {
        pixels[index] = (pixels[index] ?? 0) - ((slack[index] ?? 0) / capacity) * shrink;
      }
    }
  }

  return pixels.map((value) => (value / available) * 100);
}

export function clampLayoutWidths(layout: PaneLayout, containerPx: number): PaneLayout {
  if (containerPx <= 0 || layout.panes.length === 0) return layout;
  const widths = clampPaneWidths(
    layout.panes.map((pane) => pane.width),
    containerPx,
  );
  const unchanged = widths.every(
    (width, index) => Math.abs(width - (layout.panes[index]?.width ?? 0)) < 0.01,
  );
  if (unchanged) return layout;
  return { panes: layout.panes.map((pane, index) => ({ ...pane, width: widths[index] ?? 0 })) };
}

function nextPaneId(panes: readonly PaneLayoutPane[]): string {
  let index = panes.length + 1;
  while (panes.some((pane) => pane.id === `pane-${index}`)) index += 1;
  return `pane-${index}`;
}

function normalizeWidths(widths: readonly number[]): number[] {
  if (widths.length === 0) return [];
  const invalid = widths.some((width) => !Number.isFinite(width) || width <= 0);
  if (invalid) return widths.map(() => 100 / widths.length);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return widths.map(() => 100 / widths.length);
  return widths.map((width) => (width / total) * 100);
}

function withWidths(panes: readonly PaneLayoutPane[]): PaneLayoutPane[] {
  const widths = normalizeWidths(panes.map((pane) => pane.width));
  return panes.map((pane, index) => ({ ...pane, width: widths[index] ?? 0 }));
}

export function addPane(layout: PaneLayout, surface: PaneSurface): PaneLayout {
  if (layout.panes.length >= MAX_PANES) return layout;
  if (surface === 'thread' || paneHasSurface(layout, surface)) return layout;

  // The new pane takes an equal share; the others shrink proportionally so
  // custom widths survive their first split.
  const share = 100 / (layout.panes.length + 1);
  const scale = (100 - share) / 100;
  const panes = layout.panes.map((pane) => ({ ...pane, width: pane.width * scale }));
  panes.push({ id: nextPaneId(layout.panes), tabs: [surface], activeTab: surface, width: share });
  return { panes };
}

export function addTab(layout: PaneLayout, paneId: string, surface: PaneSurface): PaneLayout {
  if (surface === 'thread' || paneHasSurface(layout, surface)) return layout;
  const index = layout.panes.findIndex((pane) => pane.id === paneId);
  const pane = layout.panes[index];
  if (pane === undefined) return layout;
  const panes = layout.panes.slice();
  panes[index] = { ...pane, tabs: [...pane.tabs, surface], activeTab: surface };
  return { panes };
}

export function selectTab(layout: PaneLayout, paneId: string, surface: PaneSurface): PaneLayout {
  const index = layout.panes.findIndex((pane) => pane.id === paneId);
  const pane = layout.panes[index];
  if (pane === undefined) return layout;
  if (pane.activeTab === surface || !pane.tabs.includes(surface)) return layout;
  const panes = layout.panes.slice();
  panes[index] = { ...pane, activeTab: surface };
  return { panes };
}

export function closePane(layout: PaneLayout, paneId: string): PaneLayout {
  const index = layout.panes.findIndex((pane) => pane.id === paneId);
  // The first pane hosts the thread and can never be closed.
  if (index <= 0) return layout;
  const panes = layout.panes.filter((_, position) => position !== index);
  if (panes.length === 0) return defaultPaneLayout();
  return { panes: withWidths(panes) };
}

export function closeTab(layout: PaneLayout, paneId: string, surface: PaneSurface): PaneLayout {
  if (surface === 'thread') return layout;
  const index = layout.panes.findIndex((pane) => pane.id === paneId);
  const pane = layout.panes[index];
  if (pane === undefined) return layout;
  const tabIndex = pane.tabs.indexOf(surface);
  if (tabIndex < 0) return layout;
  if (pane.tabs.length === 1) return closePane(layout, paneId);

  const tabs = pane.tabs.filter((tab) => tab !== surface);
  const activeTab =
    pane.activeTab === surface ? (tabs[Math.max(0, tabIndex - 1)] ?? tabs[0]!) : pane.activeTab;
  const panes = layout.panes.slice();
  panes[index] = { ...pane, tabs, activeTab };
  return { panes };
}

/** Moves one surface between panes. Dropping the last tab of a pane closes it. */
export function moveTab(
  layout: PaneLayout,
  fromPaneId: string,
  surface: PaneSurface,
  toPaneId: string,
  index = -1,
): PaneLayout {
  if (surface === 'thread' || fromPaneId === toPaneId) return layout;
  const from = layout.panes.find((pane) => pane.id === fromPaneId);
  const to = layout.panes.find((pane) => pane.id === toPaneId);
  if (from === undefined || to === undefined) return layout;
  if (!from.tabs.includes(surface) || to.tabs.includes(surface)) return layout;

  const sourceTabs = from.tabs.filter((tab) => tab !== surface);
  const insertAt = index < 0 || index > to.tabs.length ? to.tabs.length : index;
  const targetTabs = [...to.tabs.slice(0, insertAt), surface, ...to.tabs.slice(insertAt)];

  const moved = layout.panes.map((pane) => {
    if (pane.id === fromPaneId) {
      if (sourceTabs.length === 0) return null;
      const activeTab = pane.activeTab === surface ? (sourceTabs[0] ?? surface) : pane.activeTab;
      return { ...pane, tabs: sourceTabs, activeTab };
    }
    if (pane.id === toPaneId) return { ...pane, tabs: targetTabs, activeTab: surface };
    return pane;
  });

  const panes = moved.filter((pane): pane is PaneLayoutPane => pane !== null);
  if (panes.length === moved.length) return { panes };
  return { panes: withWidths(panes) };
}

/**
 * Drags the splitter at `splitterIndex`: the adjacent pair trades pixels while
 * their combined width stays fixed. Both panes clamp to 280px and 70% of the row.
 */
export function resizeSplit(
  layout: PaneLayout,
  splitterIndex: number,
  deltaPx: number,
  containerPx: number,
): PaneLayout {
  const count = layout.panes.length;
  if (splitterIndex < 0 || splitterIndex >= count - 1) return layout;
  const available = paneAvailableWidth(containerPx, count);
  if (available <= 0) return layout;

  const pixels = layout.panes.map((pane) => (available * pane.width) / 100);
  const left = pixels[splitterIndex] ?? 0;
  const right = pixels[splitterIndex + 1] ?? 0;
  const pair = left + right;
  const minPane = Math.min(MIN_PANE_WIDTH_PX, pair / 2);
  const maxPane = available * MAX_PANE_WIDTH_RATIO;
  const lower = Math.max(minPane, pair - maxPane);
  const upper = Math.min(pair - minPane, maxPane);
  const nextLeft = lower > upper ? pair / 2 : Math.min(Math.max(left + deltaPx, lower), upper);

  pixels[splitterIndex] = nextLeft;
  pixels[splitterIndex + 1] = pair - nextLeft;
  const panes = layout.panes.map((pane, index) => ({
    ...pane,
    width: ((pixels[index] ?? 0) / available) * 100,
  }));
  return { panes };
}

/** Double-click: the two panes beside a splitter go back to an even split. */
export function resetSplit(layout: PaneLayout, splitterIndex: number): PaneLayout {
  const left = layout.panes[splitterIndex];
  const right = layout.panes[splitterIndex + 1];
  if (left === undefined || right === undefined) return layout;
  const half = (left.width + right.width) / 2;
  if (Math.abs(left.width - half) < 0.01 && Math.abs(right.width - half) < 0.01) return layout;
  const panes = layout.panes.slice();
  panes[splitterIndex] = { ...left, width: half };
  panes[splitterIndex + 1] = { ...right, width: half };
  return { panes };
}

/**
 * The narrow view: one pane whose tabs are every surface open in the row, in
 * pane order. The stored layout is untouched, so widening restores the split.
 */
export function collapseToSinglePane(layout: PaneLayout): PaneLayout {
  const first = layout.panes[0];
  const tabs: PaneSurface[] = [];
  for (const pane of layout.panes) {
    for (const tab of pane.tabs) {
      if (!tabs.includes(tab)) tabs.push(tab);
    }
  }
  if (!tabs.includes('thread')) tabs.unshift('thread');
  const activeTab =
    first !== undefined && tabs.includes(first.activeTab) ? first.activeTab : tabs[0]!;
  return { panes: [{ id: first?.id ?? FIRST_PANE_ID, tabs, activeTab, width: 100 }] };
}

/**
 * Repairs a persisted layout: one to three panes, unique surfaces, a valid active
 * tab, the thread in the first pane, and widths that sum to 100.
 */
export function normalizePaneLayout(input: unknown): PaneLayout | null {
  if (typeof input !== 'object' || input === null || !('panes' in input)) return null;
  const rawPanes = input.panes;
  if (!Array.isArray(rawPanes) || rawPanes.length === 0) return null;

  const used = new Set<PaneSurface>();
  const ids = new Set<string>();
  const panes: PaneLayoutPane[] = [];

  for (const raw of rawPanes.slice(0, MAX_PANES)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rawTabs = 'tabs' in raw ? raw.tabs : undefined;
    const rawId = 'id' in raw ? raw.id : undefined;
    const rawActiveTab = 'activeTab' in raw ? raw.activeTab : undefined;
    const rawWidth = 'width' in raw ? raw.width : undefined;

    const tabs: PaneSurface[] = [];
    if (Array.isArray(rawTabs)) {
      for (const tab of rawTabs) {
        if (isPaneSurface(tab) && !used.has(tab)) {
          used.add(tab);
          tabs.push(tab);
        }
      }
    }
    if (tabs.length === 0) continue;

    let id = typeof rawId === 'string' && rawId.length > 0 ? rawId : `pane-${panes.length + 1}`;
    while (ids.has(id)) id = `${id}-${panes.length + 1}`;
    ids.add(id);

    const activeTab =
      isPaneSurface(rawActiveTab) && tabs.includes(rawActiveTab) ? rawActiveTab : tabs[0]!;
    const width =
      typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
    panes.push({ id, tabs, activeTab, width });
  }

  if (panes.length === 0) return null;

  // The thread surface belongs to the first pane, whatever the stored order.
  const first = panes[0]!;
  if (!first.tabs.includes('thread')) {
    const owner = panes.find((pane) => pane.tabs.includes('thread'));
    if (owner !== undefined) {
      owner.tabs = owner.tabs.filter((tab) => tab !== 'thread');
      if (owner.activeTab === 'thread') owner.activeTab = owner.tabs[0] ?? 'thread';
    }
    first.tabs.unshift('thread');
    first.activeTab = 'thread';
  }
  const kept = panes.filter((pane) => pane.tabs.length > 0);
  const repairedFirst = kept[0]!;
  if (!repairedFirst.tabs.includes('thread')) {
    repairedFirst.tabs.unshift('thread');
    repairedFirst.activeTab = 'thread';
  }

  return { panes: withWidths(kept) };
}

export interface PaneStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function paneStorageKey(threadId: string): string {
  return `tuffcode.panes.v1.${threadId}`;
}

function browserStorage(): PaneStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function parsePaneLayout(raw: string | null): PaneLayout | null {
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) return null;
    if (parsed.version !== STORAGE_VERSION) return null;
    return normalizePaneLayout(parsed);
  } catch {
    return null;
  }
}

export function loadPaneLayout(
  threadId: string,
  storage: PaneStorage | null = browserStorage(),
): PaneLayout {
  if (storage === null) return defaultPaneLayout();
  try {
    return parsePaneLayout(storage.getItem(paneStorageKey(threadId))) ?? defaultPaneLayout();
  } catch {
    return defaultPaneLayout();
  }
}

export function savePaneLayout(
  threadId: string,
  layout: PaneLayout,
  storage: PaneStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      paneStorageKey(threadId),
      JSON.stringify({ version: STORAGE_VERSION, panes: layout.panes }),
    );
  } catch {
    // Quota and privacy mode failures must not break the workspace.
  }
}
