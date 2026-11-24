import { describe, expect, it } from 'vitest';
import {
  initialInspectorTabs,
  inspectorTabsReducer,
  isInspectorTab,
  tabForThread,
  type InspectorTabsState,
} from './inspector-tabs';

function select(
  state: InspectorTabsState,
  threadId: string,
  tab: 'diff' | 'terminal' | 'brain' | 'council',
): InspectorTabsState {
  return inspectorTabsReducer(state, { type: 'select', threadId, tab });
}

describe('inspector tab reducer', () => {
  it('starts on the diff tab for any thread', () => {
    expect(tabForThread(initialInspectorTabs, 'thr_a')).toBe('diff');
    expect(tabForThread(initialInspectorTabs, null)).toBe('diff');
  });

  it('remembers the tab per thread', () => {
    let state = select(initialInspectorTabs, 'thr_a', 'brain');
    state = select(state, 'thr_b', 'terminal');

    expect(tabForThread(state, 'thr_a')).toBe('brain');
    expect(tabForThread(state, 'thr_b')).toBe('terminal');
  });

  it('opens a thread without its own choice on the last tab used anywhere', () => {
    const state = select(initialInspectorTabs, 'thr_a', 'council');

    expect(tabForThread(state, 'thr_new')).toBe('council');
    expect(tabForThread(state, null)).toBe('council');
  });

  it('keeps the last tab in sync when a thread changes its choice', () => {
    let state = select(initialInspectorTabs, 'thr_a', 'brain');
    state = select(state, 'thr_b', 'terminal');
    state = select(state, 'thr_a', 'diff');

    expect(state.lastTab).toBe('diff');
    expect(tabForThread(state, 'thr_c')).toBe('diff');
    expect(tabForThread(state, 'thr_a')).toBe('diff');
    expect(tabForThread(state, 'thr_b')).toBe('terminal');
  });

  it('returns the same state when the selection does not change', () => {
    const state = select(initialInspectorTabs, 'thr_a', 'brain');

    expect(select(state, 'thr_a', 'brain')).toBe(state);
    expect(select(state, 'thr_b', 'brain').lastTab).toBe('brain');
  });

  it('recognizes only the four inspector tabs', () => {
    expect(isInspectorTab('brain')).toBe(true);
    expect(isInspectorTab('settings')).toBe(false);
    expect(isInspectorTab(null)).toBe(false);
  });
});
