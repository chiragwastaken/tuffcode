import { statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { RpcError } from '../errors.js';

export type ShellExists = (command: string) => boolean;

/** Fallback order from spec section 14, used after `settings.shell`. */
export const FALLBACK_SHELLS: readonly string[] = ['pwsh.exe', 'powershell.exe', 'cmd.exe'];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function pathEntries(): string[] {
  const value = process.env.PATH ?? process.env.Path ?? '';
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

/**
 * True when `command` is an absolute path to a file or resolves to one on `PATH`.
 * Windows tries `PATHEXT` extensions for extensionless names, matching `where.exe`.
 */
export function commandExists(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  if (isAbsolute(trimmed)) return isFile(trimmed);
  const extensions =
    process.platform === 'win32' && extname(trimmed).length === 0
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext.length > 0)
      : [];
  for (const dir of pathEntries()) {
    if (isFile(join(dir, trimmed))) return true;
    for (const extension of extensions) {
      if (isFile(join(dir, `${trimmed}${extension}`))) return true;
    }
  }
  return false;
}

/**
 * Resolves the shell for a new pty: `settings.shell` when it exists, then
 * `pwsh.exe`, `powershell.exe`, `cmd.exe`. A configured shell that is not installed
 * falls through to the defaults instead of failing the open.
 */
export function resolveShell(
  settingsShell: string | null,
  shellExists: ShellExists = commandExists,
): string {
  const configured = settingsShell?.trim() ?? '';
  const candidates =
    configured.length > 0 ? [configured, ...FALLBACK_SHELLS] : [...FALLBACK_SHELLS];
  for (const candidate of candidates) {
    if (shellExists(candidate)) return candidate;
  }
  throw new RpcError('internal', `no usable shell found (tried ${candidates.join(', ')})`);
}
