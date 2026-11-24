import { join } from 'node:path';
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
  return new Promise((resolve, reject) => {
    const socket = protocols === undefined ? new WebSocket(url) : new WebSocket(url, protocols);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function openSocketWithHeader(url: string, authorization: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { authorization } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function rejectionStatus(url: string, protocol: string): Promise<number> {
  return new Promise((resolve, reject) => {
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
  });
}

function waitFor(socket: WebSocket, predicate: (frame: Frame) => boolean): Promise<Frame> {
  return new Promise((resolve) => {
    function onMessage(data: RawData): void {
      const frame = parseFrame(data);
      if (!predicate(frame)) return;
      socket.off('message', onMessage);
      resolve(frame);
    }
    socket.on('message', onMessage);
  });
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

  async function boot(): Promise<RunningServer> {
    env = createTempEnv();
    running = await startServer({
      version: '1.2.3',
      dbFile: join(env.root, 'ws.db'),
      writeServerJson: false,
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
    const socket = await openSocketWithHeader(
      `ws://127.0.0.1:${server.port}/ws`,
      `Bearer ${server.token}`,
    );
    sockets.push(socket);
    const response = await rpc(socket, 'req-header', 'app.health', {});
    expect(response.ok).toBe(true);
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
