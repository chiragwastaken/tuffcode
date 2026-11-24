import { homedir } from 'node:os';
import { join } from 'node:path';

function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** User home directory, preferring the same variables Electron and shells use. */
function homeDir(): string {
  return envValue('USERPROFILE') ?? envValue('HOME') ?? homedir();
}

/**
 * Tuffcode's home directory: `TUFFCODE_HOME` when set, otherwise `~/.tuffcode`.
 * Pure: resolves from the environment, never touches the filesystem.
 */
export function tuffcodeHome(): string {
  return envValue('TUFFCODE_HOME') ?? join(homeDir(), '.tuffcode');
}

/** Per-user application data directory: `%APPDATA%/Tuffcode` or the XDG config dir. */
export function appDataDir(): string {
  if (process.platform === 'win32') {
    const appData = envValue('APPDATA');
    return appData === undefined
      ? join(homeDir(), 'AppData', 'Roaming', 'Tuffcode')
      : join(appData, 'Tuffcode');
  }
  const xdg = envValue('XDG_CONFIG_HOME');
  return xdg === undefined ? join(homeDir(), '.config', 'Tuffcode') : join(xdg, 'Tuffcode');
}

export function logsDir(): string {
  return join(appDataDir(), 'logs');
}

export function dbPath(): string {
  return join(appDataDir(), 'tuffcode.db');
}

export function serverJsonPath(): string {
  return join(tuffcodeHome(), 'server.json');
}

export function tokenPath(): string {
  return join(tuffcodeHome(), 'token');
}

export function worktreesRoot(): string {
  return join(tuffcodeHome(), 'worktrees');
}

export function brainDir(): string {
  return join(tuffcodeHome(), 'brain');
}

export function secretsPath(): string {
  return join(tuffcodeHome(), 'secrets.bin');
}
