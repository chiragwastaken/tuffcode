import { createServer, type Server, type ServerResponse } from 'node:http';

export interface HealthBody {
  ok: true;
  version: string;
  pid: number;
  uptimeMs: number;
}

export interface HttpServerOptions {
  version: string;
  startedAt: number;
}

const IPV4_LOOPBACK = /^127\./;
const IPV6_MAPPED_LOOPBACK = /^::ffff:127\./i;

export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  return (
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    IPV4_LOOPBACK.test(address) ||
    IPV6_MAPPED_LOOPBACK.test(address)
  );
}

function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * True for `127.x`, `localhost` and `[::1]`, with or without a port. A missing Host
 * header (HTTP/1.0) is accepted because the socket itself is already loopback.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host.length === 0) return true;
  const hostname = hostnameOf(host).toLowerCase();
  return hostname === 'localhost' || isLoopbackAddress(hostname);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * The plain HTTP surface: `/health` for readiness probes and nothing else. Requests
 * from a non-loopback socket or with a non-loopback Host header are rejected before
 * routing. The WS upgrade is handled separately in `ws.ts`.
 */
export function createHttpServer(options: HttpServerOptions): Server {
  return createServer((request, response) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      writeJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (!isLoopbackHost(request.headers.host)) {
      writeJson(response, 403, { error: 'forbidden' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      const body: HealthBody = {
        ok: true,
        version: options.version,
        pid: process.pid,
        uptimeMs: Date.now() - options.startedAt,
      };
      writeJson(response, 200, body);
      return;
    }
    writeJson(response, 404, { error: 'not-found' });
  });
}
