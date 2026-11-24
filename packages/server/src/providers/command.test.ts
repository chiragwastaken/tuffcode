import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executableCandidate, resolveCliPath, windowsInvocation } from './command.js';

describe('provider command resolution', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function shim(): string {
    dir = mkdtempSync(join(tmpdir(), 'tuffcode-command-'));
    const file = join(dir, 'codex');
    writeFileSync(file, '#!/bin/sh\n');
    writeFileSync(`${file}.cmd`, '@echo off\r\n');
    return file;
  }

  it('prefers the real executable over the extensionless npm shim on Windows', () => {
    const file = shim();
    expect(executableCandidate(file, 'win32')).toBe(`${file}.cmd`);
    writeFileSync(`${file}.exe`, '');
    expect(executableCandidate(file, 'win32')).toBe(`${file}.exe`);
    expect(executableCandidate(`${file}.cmd`, 'win32')).toBe(`${file}.cmd`);
    expect(executableCandidate(file, 'linux')).toBe(file);
  });

  it('upgrades a PATH-resolved shim and keeps explicit paths as given', async () => {
    const file = shim();
    const resolveCommand = async (name: string): Promise<string | null> =>
      name === 'codex-work' ? file : null;

    await expect(resolveCliPath(resolveCommand, 'codex-work', 'codex', 'win32')).resolves.toBe(
      `${file}.cmd`,
    );
    await expect(resolveCliPath(resolveCommand, null, 'codex', 'win32')).resolves.toBeNull();
    await expect(resolveCliPath(resolveCommand, file, 'codex', 'win32')).resolves.toBe(file);
    await expect(
      resolveCliPath(resolveCommand, join(dir ?? '', 'missing.exe'), 'codex', 'win32'),
    ).resolves.toBeNull();
  });

  it('marks batch shims verbatim and leaves executables as argv', () => {
    expect(windowsInvocation('C:/tools/claude.exe', ['auth', 'login'], 'win32')).toEqual({
      file: 'C:/tools/claude.exe',
      args: ['auth', 'login'],
      verbatim: false,
    });
    const batch = windowsInvocation('C:/tools/codex.cmd', ['login'], 'win32');
    expect(batch.verbatim).toBe(true);
    expect(batch.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(batch.args[3]).toBe('""C:/tools/codex.cmd" login"');
    expect(windowsInvocation('C:/tools/codex.cmd', ['login'], 'linux').verbatim).toBe(false);
  });
});
