import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface RunOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type TryResult =
  | { ok: true; stdout: string }
  | { ok: false; exitCode: number | null; spawnCode: string | null; stderr: string };

/**
 * A failed `git` (or `gh`) invocation. Carries the argv and stderr for logs; handlers
 * translate it into a contract error before anything reaches the renderer.
 */
export class GitError extends Error {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly spawnCode: string | null;
  readonly stderr: string;

  constructor(input: {
    file: string;
    args: readonly string[];
    cwd: string;
    exitCode: number | null;
    spawnCode: string | null;
    stderr: string;
  }) {
    const status = input.exitCode === null ? 'no exit code' : `exit ${input.exitCode}`;
    super(`${input.file} ${input.args.join(' ')} failed (${status}): ${input.stderr.trim()}`);
    this.name = 'GitError';
    this.file = input.file;
    this.args = input.args;
    this.cwd = input.cwd;
    this.exitCode = input.exitCode;
    this.spawnCode = input.spawnCode;
    this.stderr = input.stderr;
  }
}

/** Copy of the environment with Tuffcode's bearer token removed (spec section 10). */
export function scrubbedEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  delete env.TUFFCODE_TOKEN;
  return env;
}

export function runExecutable(
  file: string,
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
        encoding: 'utf8',
        windowsHide: true,
        env: options.env ?? scrubbedEnv(),
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const code = (error as NodeJS.ErrnoException).code;
          reject(
            new GitError({
              file,
              args,
              cwd,
              exitCode: typeof code === 'number' ? code : null,
              spawnCode: typeof code === 'string' ? code : null,
              stderr,
            }),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/**
 * Runs `git -c core.longpaths=true <args>` in `cwd`. The long-path setting applies to
 * every git call (spec section 14); timeouts and buffer caps are fixed.
 */
export async function runGit(
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): Promise<string> {
  const result = await runExecutable('git', ['-c', 'core.longpaths=true', ...args], cwd, options);
  return result.stdout;
}

/** Same as `runGit` but returns a discriminated failure instead of throwing. */
export async function tryRunGit(
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): Promise<TryResult> {
  try {
    return { ok: true, stdout: await runGit(args, cwd, options) };
  } catch (error) {
    if (error instanceof GitError) {
      return {
        ok: false,
        exitCode: error.exitCode,
        spawnCode: error.spawnCode,
        stderr: error.stderr,
      };
    }
    throw error;
  }
}
