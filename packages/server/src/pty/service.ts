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
  exited: Promise<void>;
  closing: boolean;
  producedOutput: boolean;
}

const KILL_TIMEOUT_MS = 2_000;
const SHELL_EXIT_NOTICE = '\r\n[tuffcode] shell exited before producing output\r\n';

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

function runTaskkill(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile(
      'taskkill',
      ['/T', '/F', '/PID', String(pid)],
      { windowsHide: true, timeout: KILL_TIMEOUT_MS },
      () => {
        resolve();
      },
    );
  });
}

/** Resolves when the pty reports its exit, bounded so shutdown cannot hang. */
function waitForExit(session: Session): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, KILL_TIMEOUT_MS);
    timer.unref();
    void session.exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Sweeps the process tree with `taskkill /T /F` while the shell pid still exists,
 * then closes the pty. Killing the pty first would destroy the tree root before
 * taskkill could find it, so grandchildren (watchers, dev servers) would survive.
 * node-pty defers `kill` until the shell is ready, so the wait for the real exit
 * keeps `close` honest even when the tab closes before the first prompt.
 */
async function killSession(session: Session): Promise<void> {
  session.closing = true;
  const pid = session.pty.pid;
  if (process.platform === 'win32' && pid > 0) await runTaskkill(pid);
  try {
    session.pty.kill();
  } catch {
    // Already exited.
  }
  await waitForExit(session);
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
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const session: Session = {
      terminalId,
      threadId,
      cwd,
      shell,
      pty,
      exited,
      closing: false,
      producedOutput: false,
    };
    this.#sessions.set(terminalId, session);
    pty.onData((data) => {
      session.producedOutput = true;
      this.#onData({ terminalId, threadId, data });
    });
    pty.onExit(() => {
      // A spawn failure surfaces only here; tell the renderer instead of leaving a
      // blank tab with no diagnostic.
      if (!session.producedOutput && !session.closing) {
        this.#onData({ terminalId, threadId, data: SHELL_EXIT_NOTICE });
      }
      resolveExit();
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

  /** Forgets the session, then kills the pty and its process tree. */
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
