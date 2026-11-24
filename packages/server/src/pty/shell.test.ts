import { describe, expect, it } from 'vitest';
import { RpcError } from '../errors.js';
import { resolveShell } from './shell.js';

function only(...available: string[]): (command: string) => boolean {
  return (command) => available.includes(command);
}

describe('resolveShell', () => {
  it('prefers the configured shell when it exists', () => {
    const shell = resolveShell('C:\\tools\\nu.exe', only('C:\\tools\\nu.exe', 'pwsh.exe'));
    expect(shell).toBe('C:\\tools\\nu.exe');
  });

  it('falls back in spec order', () => {
    expect(resolveShell(null, only('pwsh.exe', 'powershell.exe', 'cmd.exe'))).toBe('pwsh.exe');
    expect(resolveShell(null, only('powershell.exe', 'cmd.exe'))).toBe('powershell.exe');
    expect(resolveShell(null, only('cmd.exe'))).toBe('cmd.exe');
  });

  it('ignores a configured shell that is not installed', () => {
    expect(resolveShell('missing-shell.exe', only('powershell.exe'))).toBe('powershell.exe');
  });

  it('ignores a blank configured shell', () => {
    expect(resolveShell('   ', only('cmd.exe'))).toBe('cmd.exe');
  });

  it('throws when no shell exists', () => {
    expect(() => resolveShell(null, () => false)).toThrow(RpcError);
    expect(() => resolveShell(null, () => false)).toThrow(/no usable shell/);
    expect(() => resolveShell('C:\\gone\\nu.exe', () => false)).toThrow(
      /C:\\gone\\nu\.exe, pwsh\.exe, powershell\.exe, cmd\.exe/,
    );
  });
});
