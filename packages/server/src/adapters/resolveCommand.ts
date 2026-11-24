import { execFile } from 'node:child_process';

export type ResolveCommand = (name: string) => Promise<string | null>;

/** Runs `where`/`which` and returns stdout. Injected in tests. */
export type CommandProbe = (file: string, args: string[]) => Promise<string>;

export interface ResolveCommandOptions {
  platform?: NodeJS.Platform;
  probe?: CommandProbe;
}

function defaultProbe(file: string, args: string[]): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(file, args, { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
  return promise;
}

function firstLine(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Locates an executable on PATH through `where` on Windows and `which` elsewhere.
 * Results, hits and misses alike, are cached per name so a turn never spawns the
 * lookup twice.
 */
export function createResolveCommand(options: ResolveCommandOptions = {}): ResolveCommand {
  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? defaultProbe;
  const cache = new Map<string, string | null>();

  return async (name) => {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    let resolved: string | null = null;
    try {
      const output = await probe(platform === 'win32' ? 'where' : 'which', [name]);
      resolved = firstLine(output);
    } catch {
      resolved = null;
    }
    cache.set(name, resolved);
    return resolved;
  };
}
