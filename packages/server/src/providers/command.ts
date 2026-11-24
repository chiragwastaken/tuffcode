import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { ResolveCommand } from '../adapters/resolveCommand.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a vendor CLI and resolves with its exit code and captured output. */
export type RunCommand = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>;

export interface WindowsInvocation {
  file: string;
  args: string[];
  /** True when `args` must reach ComSpec verbatim (a `.cmd`/`.bat` shim). */
  verbatim: boolean;
}

/**
 * Windows cannot start a `.cmd`/`.bat` shim through CreateProcess, so npm-installed
 * CLIs are launched through ComSpec. Every caller passes fixed literal arguments,
 * never user text. ComSpec does not understand the backslash escaping Node applies
 * to quoted arguments, so batch invocations are marked `verbatim`.
 */
export function windowsInvocation(
  file: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): WindowsInvocation {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) {
    return { file, args: [...args], verbatim: false };
  }
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe';
  return {
    file: comspec,
    args: ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`],
    verbatim: true,
  };
}

/** Default runner: never rejects, so a missing or failing CLI is a result, not a throw. */
export const runCommand: RunCommand = (file, args, timeoutMs) => {
  const invocation = windowsInvocation(file, args);
  const { promise, resolve } = Promise.withResolvers<CommandResult>();
  execFile(
    invocation.file,
    invocation.args,
    {
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    },
    (error, stdout, stderr) => {
      const out = typeof stdout === 'string' ? stdout : '';
      const err = typeof stderr === 'string' ? stderr : '';
      if (error === null) {
        resolve({ code: 0, stdout: out, stderr: err });
        return;
      }
      const code = typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout: out, stderr: err.length > 0 ? err : error.message });
    },
  );
  return promise;
};

/** A configured command may be an executable name or `[executable, ...args]`. */
export function configuredCommand(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string' && first.trim().length > 0) return first.trim();
  }
  return null;
}

const WINDOWS_EXECUTABLE_SUFFIXES = ['.exe', '.cmd', '.bat', '.com'] as const;

/**
 * `where` lists the extensionless npm shim before `codex.cmd`, and CreateProcess cannot
 * start that shim. Prefer the real executable that sits next to it.
 */
export function executableCandidate(
  file: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32' || extname(file).length > 0) return file;
  for (const suffix of WINDOWS_EXECUTABLE_SUFFIXES) {
    if (existsSync(`${file}${suffix}`)) return `${file}${suffix}`;
  }
  return file;
}

/**
 * Resolves the vendor CLI a provider should use: an explicit path is checked on disk,
 * an explicit name or the default name goes through PATH lookup. `null` means the CLI
 * is not installed.
 */
export async function resolveCliPath(
  resolveCommand: ResolveCommand,
  configured: string | null,
  name: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (configured !== null && (configured.includes('/') || configured.includes('\\'))) {
    return existsSync(configured) ? configured : null;
  }
  const resolved = await resolveCommand(configured ?? name);
  return resolved === null ? null : executableCandidate(resolved, platform);
}
