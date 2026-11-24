import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  brainDir,
  dbPath,
  localAppDataDir,
  logsDir,
  secretsPath,
  serverJsonPath,
  tokenPath,
  tuffcodeHome,
  worktreesRoot,
} from '@tuffcode/shared';

const ENV_KEYS = ['TUFFCODE_HOME', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'XDG_DATA_HOME'] as const;
const saved = new Map<string, string | undefined>();
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tuffcode-paths-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('tuffcodeHome', () => {
  it('honors TUFFCODE_HOME for user config paths', () => {
    const home = join(tempDir(), 'custom-home');
    process.env.TUFFCODE_HOME = home;

    expect(tuffcodeHome()).toBe(home);
    expect(serverJsonPath()).toBe(join(home, 'server.json'));
    expect(tokenPath()).toBe(join(home, 'token'));
    expect(brainDir()).toBe(join(home, 'brain'));
    expect(secretsPath()).toBe(join(home, 'secrets.bin'));
  });

  it('falls back to USERPROFILE/.tuffcode when TUFFCODE_HOME is unset', () => {
    const home = tempDir();
    delete process.env.TUFFCODE_HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;

    expect(tuffcodeHome()).toBe(join(home, '.tuffcode'));
  });

  it('does not create directories', () => {
    const home = join(tempDir(), 'missing-home');
    process.env.TUFFCODE_HOME = home;
    void serverJsonPath();
    void brainDir();
    expect(existsSync(home)).toBe(false);
  });
});

describe('localAppDataDir', () => {
  it('places app data under LOCALAPPDATA on win32 and XDG_DATA_HOME elsewhere', () => {
    const base = tempDir();
    if (process.platform === 'win32') {
      process.env.LOCALAPPDATA = base;
    } else {
      process.env.XDG_DATA_HOME = base;
    }

    expect(localAppDataDir()).toBe(join(base, 'Tuffcode'));
    expect(logsDir()).toBe(join(base, 'Tuffcode', 'logs'));
    expect(dbPath()).toBe(join(base, 'Tuffcode', 'tuffcode.db'));
    expect(worktreesRoot()).toBe(join(base, 'Tuffcode', 'worktrees'));
  });

  it('falls back to the platform default data directory', () => {
    const home = tempDir();
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    delete process.env.LOCALAPPDATA;
    delete process.env.XDG_DATA_HOME;

    const expected =
      process.platform === 'win32'
        ? join(home, 'AppData', 'Local', 'Tuffcode')
        : join(home, '.local', 'share', 'Tuffcode');
    expect(localAppDataDir()).toBe(expected);
  });

  it('keeps logs, db, and worktrees independent of TUFFCODE_HOME', () => {
    const base = tempDir();
    const home = join(tempDir(), 'home');
    process.env.TUFFCODE_HOME = home;
    if (process.platform === 'win32') process.env.LOCALAPPDATA = base;
    else process.env.XDG_DATA_HOME = base;

    expect(logsDir().startsWith(home)).toBe(false);
    expect(dbPath().startsWith(home)).toBe(false);
    expect(worktreesRoot().startsWith(home)).toBe(false);
    expect(logsDir().startsWith(join(base, 'Tuffcode'))).toBe(true);
    expect(dbPath().startsWith(join(base, 'Tuffcode'))).toBe(true);
    expect(worktreesRoot().startsWith(join(base, 'Tuffcode'))).toBe(true);

    expect(tokenPath().startsWith(home)).toBe(true);
    expect(serverJsonPath().startsWith(home)).toBe(true);
    expect(brainDir().startsWith(home)).toBe(true);
    expect(secretsPath().startsWith(home)).toBe(true);
  });
});
