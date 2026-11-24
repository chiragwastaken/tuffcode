import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';

export interface AcpProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
}

export interface AcpProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stream: Stream;
  readonly terminate: () => Promise<void>;
}

function quoteWindowsArg(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * npm-installed CLIs on Windows are `.cmd` shims, which `child_process.spawn`
 * cannot execute without a shell. Builds the canonical `cmd /d /s /c` line so
 * the shim runs with its arguments intact.
 */
export function windowsShellInvocation(
  command: string,
  args: readonly string[],
  comSpec: string = process.env.ComSpec ?? 'cmd.exe',
): { command: string; args: string[] } {
  return {
    command: comSpec,
    args: ['/d', '/s', '/c', [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')],
  };
}

function childEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Kills the agent process tree. Windows agents spawn grandchildren (`agy` runs a
 * Node child), so `taskkill /T` is used there; elsewhere SIGTERM then SIGKILL.
 */
function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return Promise.resolve();
  }
  const pid = child.pid;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        child.kill();
      });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000).unref();
    }
    setTimeout(finish, 5000).unref();
  });
}

/**
 * Spawns an ACP agent and wires its stdio to the SDK newline-delimited JSON
 * transport.
 */
export function startAcpProcess(options: AcpProcessOptions): AcpProcess {
  const isBatchShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(options.command);
  const invocation = isBatchShim
    ? windowsShellInvocation(options.command, options.args)
    : { command: options.command, args: [...options.args] };
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: childEnv(options.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Agent stderr is drained but never logged: it can echo prompts or file
  // contents.
  child.stderr.resume();

  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        if (child.stdin.destroyed) {
          reject(new Error('ACP agent stdin is closed'));
          return;
        }
        child.stdin.write(chunk, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
    close() {
      child.stdin.end();
    },
    abort() {
      child.stdin.destroy();
    },
  });

  let ended = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const end = (error?: unknown) => {
    if (ended) {
      return;
    }
    ended = true;
    try {
      if (error === undefined) {
        controller.close();
      } else {
        controller.error(error);
      }
    } catch {
      // The stream was already closed by the consumer.
    }
  };
  const input = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      child.stdout.on('data', (chunk: Buffer) => {
        if (ended) {
          return;
        }
        try {
          streamController.enqueue(chunk);
        } catch {
          ended = true;
        }
      });
      child.stdout.on('close', () => {
        end();
      });
      child.stdout.on('error', (error) => {
        end(error);
      });
      child.on('error', (error) => {
        end(error);
      });
    },
    cancel() {
      ended = true;
      child.stdout.destroy();
    },
  });

  return {
    child,
    stream: ndJsonStream(output, input),
    terminate: () => terminateChild(child),
  };
}
