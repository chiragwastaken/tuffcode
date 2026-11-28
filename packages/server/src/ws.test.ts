import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import {
  PairClaimResultSchema,
  PairCreateResultSchema,
  REMOTE_SESSION_COOKIE,
} from '@tuffcode/contracts';
import { tokenPath } from '@tuffcode/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { startServer, type RunningServer } from './server.js';
import { createTempEnv, type TempEnv } from './test-support.js';

interface Frame {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
  kind?: unknown;
  type?: unknown;
  payload?: unknown;
}

function parseFrame(data: RawData): Frame {
  const value: unknown = JSON.parse(data.toString());
  if (typeof value !== 'object' || value === null) throw new Error('frame is not an object');
  return value as Frame;
}

function openSocket(url: string, protocols?: string[]): Promise<WebSocket> {
  const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
  const socket = protocols === undefined ? new WebSocket(url) : new WebSocket(url, protocols);
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
  return promise;
}

function openSocketWithHeaders(
  url: string,
  headers: Record<string, string>,
  protocols?: string[],
): Promise<WebSocket> {
  const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
  const socket = new WebSocket(url, protocols ?? [], { headers });
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
  return promise;
}

function rejectionStatus(url: string, protocol: string): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const socket = new WebSocket(url, [protocol]);
  socket.once('unexpected-response', (_request, response) => {
    const status = response.statusCode ?? 0;
    response.resume();
    socket.terminate();
    resolve(status);
  });
  socket.once('error', (error) => {
    const match = /(\d{3})/.exec(error.message);
    if (match?.[1] !== undefined) resolve(Number(match[1]));
    else reject(error);
  });
  socket.once('open', () => {
    socket.terminate();
    reject(new Error('unexpected connection'));
  });
  return promise;
}

/** Raw upgrade so the test can control Host and Origin exactly as a browser would. */
function rawUpgradeStatus(port: number, headers: Record<string, string>): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const socket = connect(port, '127.0.0.1', () => {
    const lines = [
      'GET /ws HTTP/1.1',
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ];
    socket.write(lines.join('\r\n'));
  });
  let buffer = '';
  let settled = false;
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const match = /^HTTP\/1\.1 (\d{3})/.exec(buffer);
    if (match?.[1] === undefined || settled) return;
    settled = true;
    socket.destroy();
    resolve(Number(match[1]));
  });
  socket.on('error', (error) => {
    if (!settled) reject(error);
  });
  socket.on('close', () => {
    if (!settled) reject(new Error('upgrade closed without a status line'));
  });
  return promise;
}

async function pairDevice(server: RunningServer, deviceName = 'Phone'): Promise<string> {
  const create = await fetch(`http://127.0.0.1:${server.port}/pair/create`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.token}` },
  });
  expect(create.status).toBe(201);
  const { code } = PairCreateResultSchema.parse(await create.json());
  const claim = await fetch(`http://127.0.0.1:${server.port}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceName }),
  });
  expect(claim.status).toBe(201);
  PairClaimResultSchema.parse(await claim.json());
  const header = claim.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${REMOTE_SESSION_COOKIE}=([0-9a-f]{64})`).exec(header);
  if (match?.[1] === undefined) throw new Error(`no session cookie in ${header}`);
  return match[1];
}

function waitFor(socket: WebSocket, predicate: (frame: Frame) => boolean): Promise<Frame> {
  const { promise, resolve } = Promise.withResolvers<Frame>();
  function onMessage(data: RawData): void {
    const frame = parseFrame(data);
    if (!predicate(frame)) return;
    socket.off('message', onMessage);
    resolve(frame);
  }
  socket.on('message', onMessage);
  return promise;
}

function rpc(socket: WebSocket, id: string, method: string, params: unknown): Promise<Frame> {
  const reply = waitFor(socket, (frame) => frame.id === id && typeof frame.ok === 'boolean');
  socket.send(JSON.stringify({ id, method, params }));
  return reply;
}

describe('websocket transport', () => {
  let env: TempEnv | undefined;
  let running: RunningServer | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await running?.close();
    running = undefined;
    env?.dispose();
    env = undefined;
  });

  async function boot(remoteEnabled = false): Promise<RunningServer> {
    env = createTempEnv();
    running = await startServer({
      version: '1.2.3',
      dbFile: join(env.root, 'ws.db'),
      writeServerJson: false,
      remoteOverrides: remoteEnabled
        ? { enabled: true, bindHost: '127.0.0.1', port: 0, allowedOrigins: [] }
        : undefined,
    });
    return running;
  }

  it('answers app.health over a subprotocol-authenticated socket', async () => {
    const server = await boot();
    const socket = await openSocket(`ws://127.0.0.1:${server.port}/ws`, [
      `tuffcode.bearer.${server.token}`,
    ]);
    sockets.push(socket);

    const response = await rpc(socket, 'req-1', 'app.health', {});
    expect(response.ok).toBe(true);
    const result = response.result as Record<string, unknown>;
    expect(result['version']).toBe('1.2.3');
    expect(result['pid']).toBe(process.pid);
    expect(result['dbPath']).toBe(server.dbPath);
    expect(typeof result['uptimeMs']).toBe('number');
  });

  it('accepts an Authorization bearer header', async () => {
    const server = await boot();
    const socket = await openSocketWithHeaders(`ws://127.0.0.1:${server.port}/ws`, {
      authorization: `Bearer ${server.token}`,
    });
    sockets.push(socket);
    const response = await rpc(socket, 'req-header', 'app.health', {});
    expect(response.ok).toBe(true);
  });

  it('accepts a paired session cookie', async () => {
    const server = await boot();
    const token = await pairDevice(server);
    const socket = await openSocketWithHeaders(`ws://127.0.0.1:${server.port}/ws`, {
      cookie: `${REMOTE_SESSION_COOKIE}=${token}`,
    });
    sockets.push(socket);
    const response = await rpc(socket, 'req-cookie', 'app.health', {});
    expect(response.ok).toBe(true);
    expect(server.repos.remoteSessions.list()).toHaveLength(1);
  });

  it('rejects a wrong token with 401 and never connects', async () => {
    const server = await boot();
    const status = await rejectionStatus(
      `ws://127.0.0.1:${server.port}/ws`,
      `tuffcode.bearer.${'0'.repeat(64)}`,
    );
    expect(status).toBe(401);
    expect(server.httpServer.listening).toBe(true);
  });

  it('rejects a non-loopback Host on upgrade when remote access is off', async () => {
    const server = await boot();
    const status = await rawUpgradeStatus(server.port, {
      Host: 'evil.example',
      Origin: `http://evil.example`,
      'Sec-WebSocket-Protocol': `tuffcode.bearer.${server.token}`,
    });
    expect(status).toBe(403);
  });

  it('rejects a foreign Origin even with a valid token', async () => {
    const server = await boot();
    const status = await rawUpgradeStatus(server.port, {
      Host: `127.0.0.1:${server.port}`,
      Origin: 'http://evil.example',
      'Sec-WebSocket-Protocol': `tuffcode.bearer.${server.token}`,
    });
    expect(status).toBe(403);
  });

  it('accepts the desktop file origin with the file token', async () => {
    const server = await boot();
    const socket = await openSocketWithHeaders(`ws://127.0.0.1:${server.port}/ws`, {
      origin: 'null',
      authorization: `Bearer ${server.token}`,
    });
    sockets.push(socket);
    const response = await rpc(socket, 'req-file-origin', 'app.health', {});
    expect(response.ok).toBe(true);
  });

  it('rejects a foreign Origin for a cookie session when remote access is on', async () => {
    const server = await boot(true);
    const token = await pairDevice(server);
    const status = await rawUpgradeStatus(server.port, {
      Host: `127.0.0.1:${server.port}`,
      Origin: 'http://evil.example',
      Cookie: `${REMOTE_SESSION_COOKIE}=${token}`,
    });
    expect(status).toBe(403);
  });

  it('accepts a same-origin cookie session when remote access is on', async () => {
    const server = await boot(true);
    const token = await pairDevice(server);
    const socket = await openSocketWithHeaders(
      `ws://127.0.0.1:${server.port}/ws`,
      {
        cookie: `${REMOTE_SESSION_COOKIE}=${token}`,
        origin: `http://127.0.0.1:${server.port}`,
      },
    );
    sockets.push(socket);
    const response = await rpc(socket, 'req-lan', 'app.health', {});
    expect(response.ok).toBe(true);
  });

  it('revokes a cookie session when the file token rotates', async () => {
    const server = await boot();
    const token = await pairDevice(server);
    writeFileSync(tokenPath(), 'f'.repeat(64), 'utf8');
    const status = await rawUpgradeStatus(server.port, {
      Host: `127.0.0.1:${server.port}`,
      Cookie: `${REMOTE_SESSION_COOKIE}=${token}`,
    });
    expect(status).toBe(401);
    expect(server.repos.remoteSessions.list().every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('rejects unknown methods and invalid params with bad-request', async () => {
    const server = await boot();
    const socket = await openSocket(`ws://127.0.0.1:${server.port}/ws`, [
      `tuffcode.bearer.${server.token}`,
    ]);
    sockets.push(socket);

    const unknown = await rpc(socket, 'req-2', 'threads.send', {});
    expect(unknown.ok).toBe(false);
    expect((unknown.error as Record<string, unknown>)['code']).toBe('bad-request');

    const invalid = await rpc(socket, 'req-3', 'projects.add', {});
    expect(invalid.ok).toBe(false);
    expect((invalid.error as Record<string, unknown>)['code']).toBe('bad-request');
  });

  it('broadcasts server events to connected clients', async () => {
    const server = await boot();
    const socket = await openSocket(`ws://127.0.0.1:${server.port}/ws`, [
      `tuffcode.bearer.${server.token}`,
    ]);
    sockets.push(socket);
    const frame = waitFor(
      socket,
      (candidate) => candidate.kind === 'event' && candidate.type === 'server.warning',
    );
    server.bus.emit({
      kind: 'event',
      type: 'server.warning',
      payload: { message: 'heads up' },
    });
    const event = await frame;
    expect(event.payload).toEqual({ message: 'heads up' });
  });
});
