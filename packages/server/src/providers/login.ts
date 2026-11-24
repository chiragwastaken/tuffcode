import { execFile } from 'node:child_process';
import type { ProviderKind } from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { spawn } from 'node-pty';
import type { ResolveCommand } from '../adapters/resolveCommand.js';
import type { Repos } from '../db/repos/index.js';
import { badRequest, notFound } from '../errors.js';
import type { EventBus } from '../events.js';
import { terminalEnv } from '../pty/service.js';
import { configuredCommand, resolveCliPath, windowsInvocation } from './command.js';
import { HINTS } from './hints.js';

/** The subset of a node-pty session the login flow needs. */
export interface LoginPty {
  readonly pid: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number) => void): void;
  kill(): void;
}

/** `args` is argv, or a raw command line when node-pty must pass it verbatim. */
export type SpawnLoginPty = (
  file: string,
  args: string[] | string,
  env: Record<string, string>,
) => LoginPty;

/** Kills the login process and every child it started. */
export type KillLoginTree = (pid: number) => Promise<void>;

export interface ProviderLogins {
  start(providerId: string): Promise<{ loginId: string }>;
  cancel(loginId: string): Promise<void>;
}

export interface ProviderLoginsDeps {
  repos: Repos;
  bus: EventBus;
  resolveCommand: ResolveCommand;
  spawnPty?: SpawnLoginPty;
  killTree?: KillLoginTree;
}

interface LoginFlow {
  readonly name: string;
  readonly args: readonly string[];
  readonly configKey: string;
  readonly hint: string;
}

/** Only subscription providers sign in through a vendor CLI. */
const LOGIN_FLOWS: Partial<Record<ProviderKind, LoginFlow>> = {
  claude: {
    name: 'claude',
    args: ['auth', 'login'],
    configKey: 'pathToClaudeCodeExecutable',
    hint: HINTS.claude,
  },
  codex: { name: 'codex', args: ['login'], configKey: 'command', hint: HINTS.codex },
};

const KILL_TIMEOUT_MS = 2_000;

function defaultSpawnPty(
  file: string,
  args: string[] | string,
  env: Record<string, string>,
): LoginPty {
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env,
    useConptyDll: true,
  });
  return {
    // ConPTY assigns the real pid asynchronously, so read it when cancel asks for it.
    get pid() {
      return pty.pid;
    },
    onData: (listener) => {
      pty.onData(listener);
    },
    onExit: (listener) => {
      pty.onExit(({ exitCode }) => {
        listener(exitCode);
      });
    },
    kill: () => {
      try {
        pty.kill();
      } catch {
        // Already exited.
      }
    },
  };
}

function defaultKillTree(pid: number): Promise<void> {
  if (process.platform !== 'win32' || pid <= 0) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  execFile(
    'taskkill',
    ['/T', '/F', '/PID', String(pid)],
    { windowsHide: true, timeout: KILL_TIMEOUT_MS },
    () => {
      resolve();
    },
  );
  return promise;
}

interface LoginSession {
  providerId: string;
  pty: LoginPty;
  cancelled: boolean;
}

/**
 * Owns the live vendor-CLI login processes. Output is streamed to the bus chunk by
 * chunk and never buffered or written to disk; the renderer is the only scrollback.
 */
export function createProviderLogins(deps: ProviderLoginsDeps): ProviderLogins {
  const spawnPty = deps.spawnPty ?? defaultSpawnPty;
  const killTree = deps.killTree ?? defaultKillTree;
  const sessions = new Map<string, LoginSession>();

  function finish(loginId: string, exitCode: number): void {
    const session = sessions.get(loginId);
    if (session === undefined) return;
    sessions.delete(loginId);
    const ok = !session.cancelled && exitCode === 0;
    deps.bus.emit({
      kind: 'event',
      type: 'provider.login.done',
      payload: {
        loginId,
        providerId: session.providerId,
        ok,
        detail: session.cancelled
          ? 'cancelled'
          : ok
            ? 'signed in'
            : `login exited with code ${exitCode}`,
      },
    });
  }

  return {
    start: async (providerId) => {
      const provider = deps.repos.providers.get(providerId);
      if (provider === undefined) throw notFound('provider not found');
      const flow = LOGIN_FLOWS[provider.kind];
      if (flow === undefined) {
        throw badRequest(`${provider.kind} providers have no sign-in flow`);
      }
      const configured = configuredCommand(provider.config[flow.configKey]);
      const cliPath = await resolveCliPath(deps.resolveCommand, configured, flow.name);
      if (cliPath === null) throw badRequest(`${flow.hint} (${flow.name} was not found)`);

      const invocation = windowsInvocation(cliPath, flow.args);
      // node-pty appends a raw command line after the executable verbatim, which is
      // what ComSpec needs; argv goes through node-pty's quoting for direct spawns.
      const commandArgs = invocation.verbatim ? invocation.args.join(' ') : invocation.args;
      const loginId = newId('login');
      const pty = spawnPty(invocation.file, commandArgs, terminalEnv());
      sessions.set(loginId, { providerId, pty, cancelled: false });
      pty.onData((chunk) => {
        deps.bus.emit({
          kind: 'event',
          type: 'provider.login.output',
          payload: { loginId, providerId, chunk },
        });
      });
      pty.onExit((exitCode) => {
        finish(loginId, exitCode);
      });
      return { loginId };
    },

    cancel: async (loginId) => {
      const session = sessions.get(loginId);
      if (session === undefined) throw notFound('login not found');
      session.cancelled = true;
      await killTree(session.pty.pid);
      session.pty.kill();
    },
  };
}
