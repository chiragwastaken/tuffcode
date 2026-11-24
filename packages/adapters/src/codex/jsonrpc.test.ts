import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createJsonlRpcClient,
  parseRpcMessage,
  RpcClosedError,
  RpcRequestError,
  RpcTimeoutError,
} from './jsonrpc.js';

function createHarness(requestTimeoutMs = 1_000) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: Record<string, unknown>[] = [];
  const notifications: { method: string; params: unknown }[] = [];
  const requests: { id: string | number; method: string; params: unknown }[] = [];
  const closes: string[] = [];

  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      frames.push(JSON.parse(line) as Record<string, unknown>);
      index = buffer.indexOf('\n');
    }
  });

  const client = createJsonlRpcClient({
    input,
    output,
    requestTimeoutMs,
    handlers: {
      onNotification: (method, params) => notifications.push({ method, params }),
      onRequest: (id, method, params) => requests.push({ id, method, params }),
      onClose: (reason) => closes.push(reason),
    },
  });

  const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);

  return { client, input, output, frames, notifications, requests, closes, send };
}

// Streams emit data on the next tick; setImmediate flushes that queue without
// binding the test to wall-clock time.
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('parseRpcMessage', () => {
  it('classifies requests, notifications, responses, and errors', () => {
    expect(parseRpcMessage('')).toBeNull();
    expect(parseRpcMessage('not json')).toBeNull();
    expect(parseRpcMessage('[]')).toBeNull();
    expect(parseRpcMessage('{"id":1}')).toBeNull();

    expect(parseRpcMessage('{"id":1,"method":"turn/start","params":{"a":1}}')).toEqual({
      kind: 'request',
      id: 1,
      method: 'turn/start',
      params: { a: 1 },
    });
    expect(parseRpcMessage('{"method":"initialized"}')).toEqual({
      kind: 'notification',
      method: 'initialized',
      params: undefined,
    });
    expect(parseRpcMessage('{"id":2,"result":{"ok":true}}')).toEqual({
      kind: 'response',
      id: 2,
      result: { ok: true },
    });
    expect(parseRpcMessage('{"id":"srv-1","error":{"code":-32602,"message":"bad"}}')).toEqual({
      kind: 'error',
      id: 'srv-1',
      error: { code: -32602, message: 'bad', data: undefined },
    });
  });
});

describe('createJsonlRpcClient', () => {
  it('writes newline-delimited frames without a jsonrpc field', async () => {
    const harness = createHarness();
    const pending = harness.client.request('initialize', {
      clientInfo: { name: 'tuffcode', title: 'Tuffcode', version: '0.0.0' },
      capabilities: null,
    });
    await flush();

    expect(harness.frames).toHaveLength(1);
    const frame = harness.frames[0] ?? {};
    expect(frame).toEqual({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'tuffcode', title: 'Tuffcode', version: '0.0.0' },
        capabilities: null,
      },
    });
    expect('jsonrpc' in frame).toBe(false);

    harness.send({ id: 1, result: { userAgent: 'codex' } });
    await expect(pending).resolves.toEqual({ userAgent: 'codex' });
  });

  it('correlates out-of-order responses by id', async () => {
    const harness = createHarness();
    const first = harness.client.request('thread/start', {});
    const second = harness.client.request('turn/start', {});
    await flush();

    expect(harness.frames.map((frame) => frame.id)).toEqual([1, 2]);

    harness.send({ id: 2, result: { turn: { id: 't2' } } });
    await expect(second).resolves.toEqual({ turn: { id: 't2' } });

    harness.send({ id: 1, result: { thread: { id: 'th1' } } });
    await expect(first).resolves.toEqual({ thread: { id: 'th1' } });
  });

  it('rejects a request that outlives the deadline', async () => {
    const harness = createHarness(20);
    const pending = harness.client.request('turn/start', { threadId: 'th1' });

    await expect(pending).rejects.toBeInstanceOf(RpcTimeoutError);
    await expect(pending).rejects.toMatchObject({ method: 'turn/start', timeoutMs: 20 });

    // A late response is ignored rather than resolving a second time.
    harness.send({ id: 1, result: {} });
    await flush();
  });

  it('dispatches notifications and server requests', async () => {
    const harness = createHarness();
    harness.send({ method: 'item/agentMessage/delta', params: { delta: 'hi' } });
    harness.send({ id: 7, method: 'item/commandExecution/requestApproval', params: { itemId: 'c1' } });
    await flush();

    expect(harness.notifications).toEqual([
      { method: 'item/agentMessage/delta', params: { delta: 'hi' } },
    ]);
    expect(harness.requests).toEqual([
      { id: 7, method: 'item/commandExecution/requestApproval', params: { itemId: 'c1' } },
    ]);

    harness.client.respond(7, { decision: 'accept' });
    await flush();
    expect(harness.frames.at(-1)).toEqual({ id: 7, result: { decision: 'accept' } });
  });

  it('buffers split frames and ignores malformed lines', async () => {
    const harness = createHarness();
    harness.input.write('{"method":"one",');
    harness.input.write('"params":{"n":1}}\n');
    harness.input.write('garbage\n');
    harness.send({ method: 'two' });
    await flush();

    expect(harness.notifications.map((entry) => entry.method)).toEqual(['one', 'two']);
    expect(harness.notifications[0]?.params).toEqual({ n: 1 });
  });

  it('surfaces JSON-RPC error responses with the method name', async () => {
    const harness = createHarness();
    const pending = harness.client.request('turn/start', {});
    await flush();

    harness.send({ id: 1, error: { code: -32602, message: 'invalid params' } });
    await expect(pending).rejects.toBeInstanceOf(RpcRequestError);
    await expect(pending).rejects.toMatchObject({ method: 'turn/start', code: -32602 });
  });

  it('rejects pending requests and reports close when the stream ends', async () => {
    const harness = createHarness();
    const pending = harness.client.request('turn/start', {});
    await flush();

    harness.input.end();
    await expect(pending).rejects.toBeInstanceOf(RpcClosedError);
    expect(harness.closes).toEqual(['stream closed']);
    expect(harness.client.isClosed()).toBe(true);
  });

  it('dispose rejects pending work and refuses new requests', async () => {
    const harness = createHarness();
    const pending = harness.client.request('turn/start', {});
    await flush();

    harness.client.dispose('adapter disposed');
    await expect(pending).rejects.toBeInstanceOf(RpcClosedError);
    await expect(harness.client.request('thread/start', {})).rejects.toBeInstanceOf(RpcClosedError);
    expect(harness.closes).toEqual([]);
  });
});
