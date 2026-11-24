import { describe, expect, it } from 'vitest';
import type { TerminalTabsState } from './terminal-tabs';
import { initialTerminalTabs, terminalTabsReducer } from './terminal-tabs';

function open(state: TerminalTabsState, ...terminalIds: string[]): TerminalTabsState {
  return terminalIds.reduce(
    (current, terminalId) => terminalTabsReducer(current, { type: 'open', terminalId }),
    state,
  );
}

describe('terminal tab reducer', () => {
  it('opens a tab per terminal and activates the newest one', () => {
    const state = open(initialTerminalTabs, 'term-1', 'term-2');

    expect(state.tabs.map((tab) => tab.terminalId)).toEqual(['term-1', 'term-2']);
    expect(state.activeId).toBe('term-2');
  });

  it('does not duplicate a tab when the same terminal opens twice', () => {
    const state = open(open(initialTerminalTabs, 'term-1', 'term-2'), 'term-1');

    expect(state.tabs.map((tab) => tab.terminalId)).toEqual(['term-1', 'term-2']);
    expect(state.activeId).toBe('term-1');
  });

  it('activates an existing tab and ignores unknown ids', () => {
    const state = open(initialTerminalTabs, 'term-1', 'term-2');

    expect(terminalTabsReducer(state, { type: 'activate', terminalId: 'term-1' }).activeId).toBe(
      'term-1',
    );
    expect(terminalTabsReducer(state, { type: 'activate', terminalId: 'missing' })).toBe(state);
  });

  it('closes a background tab without changing the active one', () => {
    const state = open(initialTerminalTabs, 'term-1', 'term-2', 'term-3');
    const next = terminalTabsReducer(state, { type: 'close', terminalId: 'term-1' });

    expect(next.tabs.map((tab) => tab.terminalId)).toEqual(['term-2', 'term-3']);
    expect(next.activeId).toBe('term-3');
  });

  it('closing the active tab falls back to the left neighbour, then the right', () => {
    const three = open(initialTerminalTabs, 'term-1', 'term-2', 'term-3');

    const middle = terminalTabsReducer(three, { type: 'close', terminalId: 'term-3' });
    expect(middle.activeId).toBe('term-2');

    const first = terminalTabsReducer(middle, { type: 'close', terminalId: 'term-2' });
    expect(first.activeId).toBe('term-1');

    const empty = terminalTabsReducer(first, { type: 'close', terminalId: 'term-1' });
    expect(empty).toEqual(initialTerminalTabs);
  });

  it('ignores closing a terminal that is not open', () => {
    const state = open(initialTerminalTabs, 'term-1');

    expect(terminalTabsReducer(state, { type: 'close', terminalId: 'missing' })).toBe(state);
  });

  it('resets every tab', () => {
    const state = open(initialTerminalTabs, 'term-1', 'term-2');

    expect(terminalTabsReducer(state, { type: 'reset' })).toEqual(initialTerminalTabs);
  });
});
