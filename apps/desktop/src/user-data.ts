import { resolve } from 'node:path';

/**
 * The `userData` directory to force, or `undefined` to keep Electron's default.
 *
 * Chromium resolves the default from the shell's known-folder API, not from `APPDATA`,
 * so redirecting `APPDATA` alone does not isolate it. The single-instance lock lives
 * under `userData`, so two app instances with different `TUFFCODE_HOME` still collide
 * unless this path differs too. Pure: reads the environment, never touches the disk.
 */
export function resolveUserDataPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env['TUFFCODE_USER_DATA'];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? resolve(trimmed) : undefined;
}
