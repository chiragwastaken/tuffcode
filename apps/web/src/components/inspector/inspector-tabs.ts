/** Which inspector tab each thread shows, remembered for the session. */

export const INSPECTOR_TABS = ['diff', 'terminal', 'brain', 'council', 'context'] as const;

export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export const INSPECTOR_TAB_LABEL: Record<InspectorTab, string> = {
  diff: 'Diff',
  terminal: 'Terminal',
  brain: 'Brain',
  council: 'Council',
  context: 'Context',
};

export function isInspectorTab(value: unknown): value is InspectorTab {
  return INSPECTOR_TABS.some((tab) => tab === value);
}

export interface InspectorTabsState {
  /** Explicit choice per thread. Threads not listed inherit `lastTab`. */
  byThread: Record<string, InspectorTab>;
  lastTab: InspectorTab;
}

export type InspectorTabsAction = { type: 'select'; threadId: string; tab: InspectorTab };

export const initialInspectorTabs: InspectorTabsState = { byThread: {}, lastTab: 'diff' };

export function inspectorTabsReducer(
  state: InspectorTabsState,
  action: InspectorTabsAction,
): InspectorTabsState {
  if (state.byThread[action.threadId] === action.tab && state.lastTab === action.tab) return state;
  return {
    byThread: { ...state.byThread, [action.threadId]: action.tab },
    lastTab: action.tab,
  };
}

/** The tab a thread shows: its own choice, else the last tab used anywhere. */
export function tabForThread(state: InspectorTabsState, threadId: string | null): InspectorTab {
  if (threadId === null) return state.lastTab;
  return state.byThread[threadId] ?? state.lastTab;
}
