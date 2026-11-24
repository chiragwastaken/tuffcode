import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyThemeChrome,
  readPersistedTheme,
  resolveTheme,
  TITLE_BAR_HEIGHT,
  themeChrome,
  type ThemeChromeTarget,
} from './theme';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tuffcode-theme-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface OverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

function createTarget(): {
  target: ThemeChromeTarget;
  overlays: OverlayOptions[];
  backgrounds: string[];
} {
  const overlays: OverlayOptions[] = [];
  const backgrounds: string[] = [];
  return {
    overlays,
    backgrounds,
    target: {
      setTitleBarOverlay: (options) => {
        overlays.push(options);
      },
      setBackgroundColor: (color) => {
        backgrounds.push(color);
      },
    },
  };
}

function writeTheme(dir: string, theme: string): string {
  const file = join(dir, 'tuffcode.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', JSON.stringify(theme));
  db.close();
  return file;
}

describe('theme chrome', () => {
  it('maps dark to a transparent overlay and a black window', () => {
    expect(themeChrome('dark')).toEqual({
      overlayColor: '#01000000',
      symbolColor: '#f8fafc',
      backgroundColor: '#000000',
    });
  });

  it('maps light to a light overlay and a white window', () => {
    expect(themeChrome('light')).toEqual({
      overlayColor: '#f4f4f5',
      symbolColor: '#18181b',
      backgroundColor: '#ffffff',
    });
  });

  it('resolves the system preference against the OS', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('repaints the title bar overlay and window background', () => {
    const { target, overlays, backgrounds } = createTarget();

    applyThemeChrome(target, 'light');
    applyThemeChrome(target, 'dark');

    expect(overlays).toEqual([
      { color: '#f4f4f5', symbolColor: '#18181b', height: TITLE_BAR_HEIGHT },
      { color: '#01000000', symbolColor: '#f8fafc', height: TITLE_BAR_HEIGHT },
    ]);
    expect(backgrounds).toEqual(['#ffffff', '#000000']);
  });
});

describe('readPersistedTheme', () => {
  it('reads a persisted light theme', () => {
    expect(readPersistedTheme(writeTheme(tempDir(), 'light'))).toBe('light');
  });

  it('reads a persisted dark theme', () => {
    expect(readPersistedTheme(writeTheme(tempDir(), 'dark'))).toBe('dark');
  });

  it('falls back to dark when the database or row is missing', () => {
    const dir = tempDir();
    expect(readPersistedTheme(join(dir, 'missing.db'))).toBe('dark');

    const empty = join(dir, 'empty.db');
    const db = new DatabaseSync(empty);
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.close();
    expect(readPersistedTheme(empty)).toBe('dark');
  });

  it('falls back to dark when the stored value is not a theme', () => {
    expect(readPersistedTheme(writeTheme(tempDir(), 'blue'))).toBe('dark');
  });
});
