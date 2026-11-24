import { describe, expect, it, vi } from 'vitest';
import {
  requestTerminalAt,
  subscribeTerminalRequests,
  takeTerminalRequest,
  terminalCdCommand,
} from './terminal-requests';

describe('terminal request hand-off', () => {
  it('quotes a cd for the file directory', () => {
    expect(terminalCdCommand('src/components/app.tsx')).toBe('cd "src/components"\r');
    expect(terminalCdCommand('e2e-added.txt')).toBe('cd "."\r');
    expect(terminalCdCommand('src\\windows\\path.ts')).toBe('cd "src/windows"\r');
  });

  it('keeps one pending request and delivers it once', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalRequests(listener);

    requestTerminalAt('src/a.ts');
    expect(listener).toHaveBeenCalledOnce();
    expect(takeTerminalRequest()).toBe('src/a.ts');
    expect(takeTerminalRequest()).toBeNull();

    unsubscribe();
    requestTerminalAt('src/b.ts');
    expect(listener).toHaveBeenCalledOnce();
    expect(takeTerminalRequest()).toBe('src/b.ts');
  });
});
