import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny WebSocket RPC client for harness setup. The renderer and this client speak
 * the same authenticated protocol: the bearer token rides in the WS subprotocol.
 */

export interface ServerJson {
  port: number;
  token: string;
}

export interface HarnessRpc {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

interface RpcResponse {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

export function readServerJson(home: string): ServerJson {
  const raw = readFileSync(join(home, 'server.json'), 'utf8');
  const parsed = JSON.parse(raw) as Partial<ServerJson>;
  if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') {
    throw new Error('server.json is missing the port or token');
  }
  return { port: parsed.port, token: parsed.token };
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitForServerJson(home: string): Promise<ServerJson> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return readServerJson(home);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error('the server never wrote server.json: ' + String(lastError));
}

export async function connectRpc(home: string): Promise<HarnessRpc> {
  const { port, token } = await waitForServerJson(home);
  const socket = new WebSocket('ws://127.0.0.1:' + String(port) + '/ws', [
    'tuffcode.bearer.' + token,
  ]);
  const open = Promise.withResolvers<void>();
  socket.addEventListener('open', () => open.resolve());
  socket.addEventListener('error', () => open.reject(new Error('RPC socket failed')));
  await open.promise;

  const pending = new Map<string, (response: RpcResponse) => void>();
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as RpcResponse;
    if (typeof frame.id !== 'string') return;
    const settle = pending.get(frame.id);
    if (settle === undefined) return;
    pending.delete(frame.id);
    settle(frame);
  });

  let nextId = 0;
  return {
    request: (method, params) => {
      nextId += 1;
      const id = 'e2e-' + String(nextId);
      const result = Promise.withResolvers<unknown>();
      const timer = setTimeout(() => {
        pending.delete(id);
        result.reject(new Error('RPC ' + method + ' timed out'));
      }, 15_000);
      pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.ok === true) {
          result.resolve(response.result);
          return;
        }
        const message =
          typeof response.error?.message === 'string' ? response.error.message : 'RPC failed';
        result.reject(new Error(method + ': ' + message));
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result.promise;
    },
    close: () => {
      socket.close();
    },
  };
}
