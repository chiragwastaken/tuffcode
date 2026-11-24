import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { newId, normalizePath, toLongPath } from '@tuffcode/shared';
import { spawn, type IPty } from 'node-pty';
import type { Repos } from '../db/repos/index.js';
import { conflict, notFound } from '../errors.js';
import { requireWorktree } from '../git/context.js';
import { scrubbedEnv } from '../git/runGit.js';
import { resolveShell, type ShellExists } from './shell.js';

/** One chunk of pty output, tagged so the caller can broadcast `terminal.data`. */
export interface TerminalDataEvent {
  terminalId: string;
  threadId: string;
  data: string;
}

export type TerminalDataSink = (event: TerminalDataEvent) => void;

export interface TerminalSessionInfo {
  terminalId: string;
  threadId: string;
  cwd: string;
  shell: string;
}

export interface TerminalServiceOptions {
  repos: Repos;
  onData: TerminalDataSink;
  shellExists?: ShellExists;
}

interface Session extends TerminalSessionInfo {
  pty: IPty;
}

const TASKKILL_TIMEOUT_MS = 5_000;

/**
 * Environment for a pty: the server's own environment with every spelling of the
 * bearer token removed and `TERM` pinned to what the renderer's xterm expects.
 */
export function terminalEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(scrubbedEnv(source))) {
    if (value === undefined) continue;
    // Windows environment keys are case-insensitive, so drop every spelling.
    if (key.toUpperCase() === 'TUFFCODE_TOKEN') continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  return env;
}

function worktreeCwd(worktreePath: string): string {
  const cwd = toLongPath(normalizePath(worktreePath));
  let isDirectory = false;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw conflict('thread worktree is not a directory');
  return cwd;
}

/**
 * Kills the shell, then sweeps the whole process tree with `taskkill /T /F` on
 * Windows. A bare pty kill leaves grandchildren (build watchers, dev servers) alive.
 */
function killSession(session: Session): Promise<void> {
  try {
    session.pty.kill();
  } catch {
    // Already exited; taskkill below still covers surviving children.
  }
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise<void>((resolve) => {
    execFile(
      'taskkill',
      ['/T', '/F', '/PID', String(session.pty.pid)],
      { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
      () => {
        resolve();
      },
    );
  });
}

/**
 * Owns every live pty, one per terminal tab. Output is forwarded chunk by chunk to
 * `onData` and never buffered here: the renderer's xterm is the only scrollback.
 */
export class TerminalService {
  readonly #repos: Repos;
  readonly #onData: TerminalDataSink;
  readonly #shellExists: ShellExists | undefined;
  readonly #sessions = new Map<string, Session>();

  constructor(options: TerminalServiceOptions) {
    this.#repos = options.repos;
    this.#onData = options.onData;
    this.#shellExists = options.shellExists;
  }

  get size(): number {
    return this.#sessions.size;
  }

  /** Session metadata, or undefined once the pty has exited or been closed. */
  get(terminalId: string): TerminalSessionInfo | undefined {
    const session = this.#sessions.get(terminalId);
    if (session === undefined) return undefined;
    return {
      terminalId: session.terminalId,
      threadId: session.threadId,
      cwd: session.cwd,
      shell: session.shell,
    };
  }

  /** Spawns a shell in the thread's worktree and returns the new terminal id. */
  open(threadId: string, cols: number, rows: number): { terminalId: string } {
    const { worktreePath } = requireWorktree(this.#repos, threadId);
    const cwd = worktreeCwd(worktreePath);
    const shell = resolveShell(this.#repos.settings.get().shell, this.#shellExists);
    const terminalId = newId('term');
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: terminalEnv(),
      useConptyDll: true,
    });
    this.#sessions.set(terminalId, { terminalId, threadId, cwd, shell, pty });
    pty.onData((data) => {
      this.#onData({ terminalId, threadId, data });
    });
    pty.onExit(() => {
      this.#sessions.delete(terminalId);
    });
    return { terminalId };
  }

  input(terminalId: string, data: string): void {
    this.#session(terminalId).pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.#session(terminalId).pty.resize(cols, rows);
  }

  /** Kills the pty and its process tree, then forgets the session. */
  async close(terminalId: string): Promise<void> {
    const session = this.#session(terminalId);
    this.#sessions.delete(terminalId);
    await killSession(session);
  }

  /** Kills every session; the server calls this on shutdown. */
  async disposeAll(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(sessions.map((session) => killSession(session)));
  }

  #session(terminalId: string): Session {
    const session = this.#sessions.get(terminalId);
    if (session === undefined) throw notFound('terminal not found');
    return session;
  }
}
