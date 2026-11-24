import { mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { dbPath as defaultDbPath, serverJsonPath } from '@tuffcode/shared';
import { ensureToken, verifyToken } from './auth.js';
import { closeDb, migrate, openDb } from './db/index.js';
import { createRepos, type Repos } from './db/repos/index.js';
import { createEventBus, type EventBus } from './events.js';
import { createHttpServer as createHttpSurface } from './http.js';
import { createRpcHandlers, type RpcHandlers } from './rpc.js';
import { attachWebSocket, type AttachedWebSocket } from './ws.js';

export interface ServerJson {
  port: number;
  token: string;
  pid: number;
  startedAt: number;
}

export interface StartServerOptions {
  version?: string;
  dbFile?: string;
  port?: number;
  writeServerJson?: boolean;
}

export interface RunningServer {
  port: number;
  token: string;
  dbPath: string;
  db: DatabaseSync;
  repos: Repos;
  bus: EventBus;
  handlers: RpcHandlers;
  httpServer: Server;
  close(): Promise<void>;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeHttp(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/** Writes `~/.tuffcode/server.json` with mode 0600 for the Electron main process. */
export function writeServerJson(info: ServerJson): void {
  const file = serverJsonPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(info, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Boots the Node-side core: database plus migrations, token, HTTP surface, WS
 * transport, RPC registry, and the `server.json` handshake. Binds 127.0.0.1 on an
 * OS-assigned port unless one is supplied.
 */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const version = options.version ?? process.env.TUFFCODE_APP_VERSION ?? '0.0.0';
  const file = options.dbFile ?? defaultDbPath();
  const db = openDb(file);
  migrate(db);
  const repos = createRepos(db);
  const bus = createEventBus();
  const token = ensureToken();
  const startedAt = Date.now();
  const httpServer = createHttpSurface({ version, startedAt });
  const handlers = createRpcHandlers({ repos, bus, version, startedAt, dbPath: file });
  const ws: AttachedWebSocket = attachWebSocket(httpServer, { handlers, bus, verifyToken });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await ws.close();
    httpServer.closeIdleConnections();
    httpServer.closeAllConnections();
    await closeHttp(httpServer);
    closeDb(db);
  };

  try {
    await listen(httpServer, options.port ?? 0);
  } catch (error) {
    await close();
    throw error;
  }
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    await close();
    throw new Error('server did not bind a TCP port');
  }
  const port = (address as AddressInfo).port;

  if (options.writeServerJson !== false) {
    try {
      writeServerJson({ port, token, pid: process.pid, startedAt });
    } catch (error) {
      await close();
      throw error;
    }
  }

  return { port, token, dbPath: file, db, repos, bus, handlers, httpServer, close };
}
