import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCK_WIDTH,
  EMPTY_DOCK,
  INSPECTOR_TABS,
  INSPECTOR_TAB_LABEL,
  MIN_DOCK_WIDTH,
  activeDockTab,
  clampDockWidth,
  closeDock,
  closeDockTab,
  isInspectorTab,
  loadDockState,
  openDockTab,
  saveDockWidth,
  toggleDockTab,
  visibleDockTabs,
} from './inspector-tabs';

const work = { executionMode: 'work' as const };
const council = { executionMode: 'council' as const };

function memoryStorage(): { data: Map<string, string>; getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe('dock model', () => {
  it('labels every tab and recognizes only known ones', () => {
    for (const tab of INSPECTOR_TABS) expect(INSPECTOR_TAB_LABEL[tab].length).toBeGreaterThan(0);
    expect(isInspectorTab('files')).toBe(true);
    expect(isInspectorTab('context')).toBe(false);
  });

  it('starts empty, so the dock is hidden until a panel is asked for', () => {
    expect(EMPTY_DOCK.tabs).toEqual([]);
    expect(activeDockTab(EMPTY_DOCK, work)).toBeNull();
  });

  it('opens, toggles and closes tabs, keeping the neighbour in front', () => {
    let dock = openDockTab(EMPTY_DOCK, 'activity');
    dock = openDockTab(dock, 'terminal');
    dock = openDockTab(dock, 'files');
    expect(dock).toMatchObject({ tabs: ['activity', 'terminal', 'files'], active: 'files' });
    dock = toggleDockTab(dock, 'terminal');
    expect(dock.active).toBe('terminal');
    dock = toggleDockTab(dock, 'terminal');
    expect(dock).toMatchObject({ tabs: ['activity', 'files'], active: 'activity' });
    expect(closeDockTab(dock, 'diff')).toBe(dock);
    expect(closeDock(dock)).toMatchObject({ tabs: [], active: null });
    expect(openDockTab(dock, 'activity')).toBe(dock);
  });

  it('hides the council tab outside council threads', () => {
    const dock = openDockTab(openDockTab(EMPTY_DOCK, 'activity'), 'council');
    expect(visibleDockTabs(dock, work)).toEqual(['activity']);
    expect(activeDockTab(dock, work)).toBe('activity');
    expect(activeDockTab(dock, council)).toBe('council');
  });

  it('clamps the width between the minimum and 60 percent of the window', () => {
    expect(clampDockWidth(100, 1400)).toBe(MIN_DOCK_WIDTH);
    expect(clampDockWidth(2000, 1400)).toBe(840);
    expect(clampDockWidth(Number.NaN, 1400)).toBe(DEFAULT_DOCK_WIDTH);
    expect(clampDockWidth(500, 300)).toBe(MIN_DOCK_WIDTH);
  });

  it('persists only the width', () => {
    const storage = memoryStorage();
    expect(loadDockState(storage)).toEqual(EMPTY_DOCK);
    saveDockWidth(520, storage);
    expect(loadDockState(storage)).toEqual({ ...EMPTY_DOCK, width: 520 });
    storage.setItem('tuffcode.dock.v1', '{broken');
    expect(loadDockState(storage)).toEqual(EMPTY_DOCK);
  });
});
