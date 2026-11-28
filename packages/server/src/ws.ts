import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  ClientRequestSchema,
  REMOTE_SESSION_COOKIE,
  ServerResponseSchema,
  type RemoteSettings,
  type ServerResponse,
} from '@tuffcode/contracts';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { readCookie, type SessionAuth } from './auth.js';
import type { EventBus } from './events.js';
import { isAllowedHost, isAllowedOrigin } from './http.js';
import { dispatch, type RpcHandlers } from './rpc.js';

const WS_PATH = '/ws';
const BEARER_PROTOCOL_PREFIX = 'tuffcode.bearer.';

export interface WebSocketDeps {
  handlers: RpcHandlers;
  bus: EventBus;
  verifyToken: (candidate: string | undefined | null) => boolean;
  verifySession: SessionAuth['verify'];
  remote: RemoteSettings;
}

export interface AttachedWebSocket {
  wss: WebSocketServer;
  close(): Promise<void>;
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/**
 * Reads the bearer token from `Authorization: Bearer <token>` or from a
 * `tuffcode.bearer.<token>` entry in `Sec-WebSocket-Protocol`. Browsers cannot set
 * arbitrary WS headers, so the subprotocol form is the renderer's path.
 */
export function extractToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  const protocolHeader = request.headers['sec-websocket-protocol'];
  const values = Array.isArray(protocolHeader)
    ? protocolHeader
    : protocolHeader === undefined
      ? []
      : [protocolHeader];
  for (const value of values) {
    for (const part of value.split(',')) {
      const protocol = part.trim();
      if (protocol.startsWith(BEARER_PROTOCOL_PREFIX)) {
        return protocol.slice(BEARER_PROTOCOL_PREFIX.length);
      }
    }
  }
  return undefined;
}

/** The paired device cookie, which browsers send on the upgrade request automatically. */
export function extractSessionToken(request: IncomingMessage): string | undefined {
  return readCookie(request.headers.cookie, REMOTE_SESSION_COOKIE);
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function idOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = value.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'invalid';
}

function sendResponse(client: WebSocket, response: ServerResponse): void {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify(ServerResponseSchema.parse(response)));
}

/**
 * Attaches the authenticated WebSocket server to an existing HTTP server on `/ws`.
 * Each frame is parsed as a `ClientRequest`, dispatched through the method registry
 * and answered with a `ServerResponse`. Server events from the bus are fanned out to
 * every connected client.
 */
export function attachWebSocket(server: Server, deps: WebSocketDeps): AttachedWebSocket {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  async function handleFrame(client: WebSocket, data: RawData): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawToString(data)) as unknown;
    } catch {
      sendResponse(client, {
        id: 'invalid',
        ok: false,
        error: { code: 'bad-request', message: 'malformed JSON' },
      });
      return;
    }
    const request = ClientRequestSchema.safeParse(parsed);
    if (!request.success) {
      sendResponse(client, {
        id: idOf(parsed),
        ok: false,
        error: { code: 'bad-request', message: 'invalid request' },
      });
      return;
    }
    sendResponse(client, await dispatch(deps.handlers, request.data));
  }

  wss.on('connection', (client: WebSocket) => {
    clients.add(client);
    client.on('close', () => {
      clients.delete(client);
    });
    client.on('error', () => {
      clients.delete(client);
    });
    client.on('message', (data) => {
      void handleFrame(client, data);
    });
  });

  const unsubscribe = deps.bus.subscribe((event) => {
    const frame = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== WS_PATH) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!isAllowedHost(request.headers.host, deps.remote)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const token = extractToken(request);
    const fileToken = deps.verifyToken(token);
    // A browser always sends Origin here; refusing a foreign one blocks cross-site
    // WebSocket hijacking when the session cookie is attached automatically. The
    // desktop renderer is a file:// origin and authenticates with the file token,
    // which a foreign page cannot read, so the token itself is the boundary there.
    const origin = request.headers.origin;
    const desktopOrigin =
      origin === undefined || origin === 'null' || origin.startsWith('file://');
    if (
      !(fileToken && desktopOrigin) &&
      !isAllowedOrigin(origin, request.headers.host, deps.remote)
    ) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const authenticated =
      fileToken ||
      (token === undefined && deps.verifySession(extractSessionToken(request)) !== undefined);
    if (!authenticated) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    try {
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request);
      });
    } catch {
      socket.destroy();
    }
  });

  return {
    wss,
    close: () => {
      unsubscribe();
      for (const client of clients) client.terminate();
      clients.clear();
      return new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
    },
  };
}
