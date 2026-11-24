import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appDataDir,
  brainDir,
  dbPath,
  logsDir,
  secretsPath,
  serverJsonPath,
  tokenPath,
  tuffcodeHome,
  worktreesRoot,
} from '@tuffcode/shared';

const ENV_KEYS = ['TUFFCODE_HOME', 'USERPROFILE', 'HOME', 'APPDATA', 'XDG_CONFIG_HOME'] as const;
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
  it('honors TUFFCODE_HOME for every home-scoped path', () => {
    const home = join(tempDir(), 'custom-home');
    process.env.TUFFCODE_HOME = home;

    expect(tuffcodeHome()).toBe(home);
    expect(serverJsonPath()).toBe(join(home, 'server.json'));
    expect(tokenPath()).toBe(join(home, 'token'));
    expect(worktreesRoot()).toBe(join(home, 'worktrees'));
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
    void worktreesRoot();
    void brainDir();
    expect(existsSync(home)).toBe(false);
  });
});

describe('appDataDir', () => {
  it('places app data under APPDATA on win32 and XDG elsewhere', () => {
    const base = tempDir();
    if (process.platform === 'win32') {
      process.env.APPDATA = base;
    } else {
      process.env.XDG_CONFIG_HOME = base;
    }

    expect(appDataDir()).toBe(join(base, 'Tuffcode'));
    expect(logsDir()).toBe(join(base, 'Tuffcode', 'logs'));
    expect(dbPath()).toBe(join(base, 'Tuffcode', 'tuffcode.db'));
  });

  it('keeps logs and db independent of TUFFCODE_HOME', () => {
    const base = tempDir();
    const home = join(tempDir(), 'home');
    process.env.TUFFCODE_HOME = home;
    if (process.platform === 'win32') process.env.APPDATA = base;
    else process.env.XDG_CONFIG_HOME = base;

    expect(logsDir().startsWith(home)).toBe(false);
    expect(dbPath().startsWith(home)).toBe(false);
  });
});
