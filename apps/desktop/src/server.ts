import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { Logger } from '@tuffcode/shared';

export const READY_TIMEOUT_MS = 10_000;
export const SHUTDOWN_TIMEOUT_MS = 5_000;

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function serverBuildCommand(): string {
  return 'pnpm --filter @tuffcode/server build';
}

export interface ServerEntryOptions {
  /** Value of `TUFFCODE_SERVER_ENTRY`, if set. */
  envEntry?: string | undefined;
  /** Whether the app is packaged (electron-builder) or running from source. */
  packaged: boolean;
  /** `process.resourcesPath` in Electron. */
  resourcesPath: string;
  /** `app.getAppPath()` in Electron. */
  appPath: string;
}

/**
 * Server bundle resolution order (spec section 1):
 * 1. `TUFFCODE_SERVER_ENTRY`
 * 2. packaged `resources/server/server.js`
 * 3. workspace `packages/server/dist/server.js`
 */
export function resolveServerEntry(options: ServerEntryOptions): string {
  const envEntry = options.envEntry?.trim();
  if (envEntry !== undefined && envEntry.length > 0) return resolve(envEntry);
  if (options.packaged) return join(options.resourcesPath, 'server', 'server.js');
  return resolve(options.appPath, '../../packages/server/dist/server.js');
}

export class ServerConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServerConnectionError';
  }
}

export interface ServerConnection {
  port: number;
  token: string;
}

/**
 * Reads the connection details the server wrote to `server.json`.
 * Throws instead of returning a half-valid connection so the caller can show one dialog.
 */
export function readServerConnection(filePath: string, expectedPort?: number): ServerConnection {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ServerConnectionError(`Could not read the server connection file at ${filePath}.`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ServerConnectionError(
      `The server connection file at ${filePath} is not valid JSON.`,
      { cause: error },
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ServerConnectionError(`The server connection file at ${filePath} is not an object.`);
  }

  const { port, token } = parsed as Record<string, unknown>;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new ServerConnectionError(
      `The server connection file at ${filePath} has an invalid port.`,
    );
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new ServerConnectionError(
      `The server connection file at ${filePath} is missing the bearer token.`,
    );
  }
  if (expectedPort !== undefined && port !== expectedPort) {
    throw new ServerConnectionError(
      `The server reported port ${expectedPort} but ${filePath} contains port ${port}.`,
    );
  }

  return { port, token };
}

export interface StartServerOptions {
  entry: string;
  env: Record<string, string | undefined>;
  logger: Logger;
  timeoutMs?: number;
}

export interface RunningServer {
  child: UtilityProcess;
  port: number;
  /** Resolves with the exit code once the child process ends. */
  exited: Promise<number>;
}

export class ServerStartError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServerStartError';
  }
}

function isReadyMessage(message: unknown): message is { type: 'ready'; port: number } {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return candidate['type'] === 'ready' && typeof candidate['port'] === 'number';
}

function pipeOutput(
  stream: NodeJS.ReadableStream | null,
  logger: Logger,
  channel: 'stdout' | 'stderr',
): void {
  if (stream === null) return;
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const text = chunk.trimEnd();
    if (text.length === 0) return;
    if (channel === 'stderr') logger.warn('server stderr', { text });
    else logger.debug('server stdout', { text });
  });
}

/** Spawns the server in a utility process and waits for its ready message. */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { entry, env, logger } = options;
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;

  const child = utilityProcess.fork(entry, [], {
    env,
    serviceName: 'tuffcode-server',
    stdio: 'pipe',
  });

  const exitState = Promise.withResolvers<number>();
  child.once('exit', (code) => exitState.resolve(code));
  child.on('error', (type: string, location: string) => {
    logger.error('server process error', { type, location });
  });

  pipeOutput(child.stdout, logger, 'stdout');
  pipeOutput(child.stderr, logger, 'stderr');

  const readyState = Promise.withResolvers<number>();
  let settled = false;
  const finish = (): boolean => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    child.off('message', onMessage);
    child.off('exit', onExit);
    child.off('error', onError);
    return true;
  };
  const onMessage = (message: unknown): void => {
    if (!isReadyMessage(message)) return;
    if (!finish()) return;
    readyState.resolve(message.port);
  };
  const onExit = (code: number): void => {
    if (!finish()) return;
    readyState.reject(
      new ServerStartError(`The server exited before it was ready (code ${code}).`),
    );
  };
  const onError = (type: string): void => {
    if (!finish()) return;
    readyState.reject(new ServerStartError(`The server failed to start (${type}).`));
  };
  const timer = setTimeout(() => {
    if (!finish()) return;
    readyState.reject(
      new ServerStartError(`The server did not report ready within ${timeoutMs / 1000} seconds.`),
    );
  }, timeoutMs);

  child.on('message', onMessage);
  child.once('exit', onExit);
  child.once('error', onError);

  let port: number;
  try {
    port = await readyState.promise;
  } catch (error) {
    child.kill();
    throw error;
  }
  logger.info('server ready', { port });
  return { child, port, exited: exitState.promise };
}

/** Asks the server to shut down, then force-kills it after the timeout. */
export async function stopServer(
  server: RunningServer,
  logger: Logger,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const forceKill = setTimeout(() => {
    logger.warn('server shutdown timed out, killing process');
    server.child.kill();
  }, timeoutMs);

  try {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- utilityProcess messages have no origin
    server.child.postMessage({ type: 'shutdown' });
  } catch (error) {
    logger.warn('could not send shutdown to the server', {
      message: error instanceof Error ? error.message : String(error),
    });
    server.child.kill();
  }

  const code = await server.exited;
  clearTimeout(forceKill);
  logger.info('server exited', { code });
}
