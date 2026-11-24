/** Tab strip state for the terminal panel. One tab per server terminal id. */

export interface TerminalTab {
  terminalId: string;
}

export interface TerminalTabsState {
  tabs: TerminalTab[];
  activeId: string | null;
}

export type TerminalTabsAction =
  | { type: 'open'; terminalId: string }
  | { type: 'close'; terminalId: string }
  | { type: 'activate'; terminalId: string }
  | { type: 'reset' };

export const initialTerminalTabs: TerminalTabsState = { tabs: [], activeId: null };

export function terminalTabsReducer(
  state: TerminalTabsState,
  action: TerminalTabsAction,
): TerminalTabsState {
  switch (action.type) {
    case 'open': {
      const known = state.tabs.some((tab) => tab.terminalId === action.terminalId);
      const tabs = known ? state.tabs : [...state.tabs, { terminalId: action.terminalId }];
      return { tabs, activeId: action.terminalId };
    }

    case 'close': {
      const index = state.tabs.findIndex((tab) => tab.terminalId === action.terminalId);
      if (index === -1) return state;

      const tabs = state.tabs.filter((tab) => tab.terminalId !== action.terminalId);
      if (state.activeId !== action.terminalId) return { tabs, activeId: state.activeId };

      // Closing the active tab falls back to the neighbour on the left, then the right.
      const next = tabs[Math.min(index, tabs.length - 1)];
      return { tabs, activeId: next ? next.terminalId : null };
    }

    case 'activate': {
      if (state.activeId === action.terminalId) return state;
      if (!state.tabs.some((tab) => tab.terminalId === action.terminalId)) return state;
      return { tabs: state.tabs, activeId: action.terminalId };
    }

    case 'reset':
      return state.tabs.length === 0 && state.activeId === null ? state : initialTerminalTabs;
  }
}
