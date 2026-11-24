import { afterEach, describe, expect, it } from 'vitest';
import { createSecretBridge, type SecretPort } from './bridge.js';

interface FakePort extends SecretPort {
  sent: unknown[];
  reply(message: unknown): void;
  close(): void;
}

function createFakePort(): FakePort {
  const listeners: ((message?: unknown) => void)[] = [];
  const closers: ((message?: unknown) => void)[] = [];
  const sent: unknown[] = [];
  return {
    sent,
    postMessage: (message) => {
      sent.push(message);
    },
    on: (event, listener) => {
      if (event === 'message') listeners.push(listener);
      else closers.push(listener);
    },
    reply: (message) => {
      for (const listener of listeners) listener(message);
    },
    close: () => {
      for (const listener of closers) listener();
    },
  };
}

function lastRequest(port: FakePort): Record<string, unknown> {
  const message = port.sent.at(-1);
  if (typeof message !== 'object' || message === null) throw new Error('no request sent');
  return message as Record<string, unknown>;
}

describe('secret bridge', () => {
  const bridges: { dispose(): void }[] = [];

  afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.dispose();
  });

  it('sends exactly a secret.get request and resolves the matching result', async () => {
    const port = createFakePort();
    const bridge = createSecretBridge(port);
    bridges.push(bridge);

    const pending = bridge.get('provider:prv_1');
    const request = lastRequest(port);
    expect(request).toEqual({
      id: request['id'],
      type: 'secret.get',
      key: 'provider:prv_1',
    });
    expect(typeof request['id']).toBe('string');

    port.reply({ id: request['id'], type: 'secret.result', ok: true, value: 'sk-live' });
    await expect(pending).resolves.toBe('sk-live');
  });

  it('forwards an empty secret value on set and resolves on success', async () => {
    const port = createFakePort();
    const bridge = createSecretBridge(port);
    bridges.push(bridge);

    const pending = bridge.set('provider:prv_1', '');
    const request = lastRequest(port);
    expect(request).toEqual({
      id: request['id'],
      type: 'secret.set',
      key: 'provider:prv_1',
      value: '',
    });

    port.reply({ id: request['id'], type: 'secret.result', ok: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it('ignores unknown ids and wrong types, and resolves concurrent requests by id', async () => {
    const port = createFakePort();
    const bridge = createSecretBridge(port);
    bridges.push(bridge);

    const first = bridge.get('provider:prv_a');
    const firstId = lastRequest(port)['id'];
    const second = bridge.get('provider:prv_b');
    const secondId = lastRequest(port)['id'];

    port.reply({ id: 'sec_unknown', type: 'secret.result', ok: true, value: 'wrong' });
    port.reply({ id: firstId, type: 'secret.not-result', ok: true, value: 'wrong' });
    port.reply({ id: secondId, type: 'secret.result', ok: true, value: 'second' });
    port.reply({ id: firstId, type: 'secret.result', ok: true, value: 'first' });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('resolves null for an empty or failed value', async () => {
    const port = createFakePort();
    const bridge = createSecretBridge(port);
    bridges.push(bridge);

    const empty = bridge.get('provider:prv_a');
    port.reply({ id: lastRequest(port)['id'], type: 'secret.result', ok: true, value: '' });
    await expect(empty).resolves.toBeNull();

    const failed = bridge.get('provider:prv_b');
    port.reply({ id: lastRequest(port)['id'], type: 'secret.result', ok: false, error: 'denied' });
    await expect(failed).resolves.toBeNull();
  });

  it('times out a pending request with a clear error', async () => {
    const port = createFakePort();
    const bridge = createSecretBridge(port, { timeoutMs: 10 });
    bridges.push(bridge);

    await expect(bridge.get('provider:prv_a')).rejects.toThrow(/timed out/);
  });

  it('rejects every pending request when the port closes', async () => {
    const port = createFakePort();
    const bridge = createSecretBridge(port);
    bridges.push(bridge);

    const first = bridge.get('provider:prv_a');
    const second = bridge.set('provider:prv_b', 'value');
    port.close();

    await expect(first).rejects.toThrow('secret bridge closed');
    await expect(second).rejects.toThrow('secret bridge closed');
  });

  it('has no fallback without a port and never reads the environment', async () => {
    process.env['TUFFCODE_TEST_SECRET'] = 'from-env';
    try {
      const bridge = createSecretBridge(undefined);
      bridges.push(bridge);
      expect(bridge.available).toBe(false);
      await expect(bridge.get('provider:prv_a')).resolves.toBeNull();
      await expect(bridge.set('provider:prv_a', 'value')).rejects.toThrow(
        'secret storage unavailable',
      );
    } finally {
      delete process.env['TUFFCODE_TEST_SECRET'];
    }
  });
});
