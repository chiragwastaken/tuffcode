import { describe, expect, it } from 'vitest';
import {
  attachSecretBridge,
  handleChildMessage,
  type SecretBridgeChild,
  type SecretBridgeLogger,
} from './bridge';
import type { SecretStore } from './secrets';

interface LogCall {
  message: string;
  fields: Record<string, unknown> | undefined;
}

function createLogger(): { logger: SecretBridgeLogger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    logger: {
      warn: (message, fields) => {
        calls.push({ message, fields });
      },
    },
  };
}

function createChild(): { child: SecretBridgeChild; messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    child: {
      postMessage: (message) => {
        messages.push(message);
      },
    },
  };
}

interface StoreOptions {
  available?: boolean;
  failGet?: Error;
  failSet?: Error;
}

function createStore(initial: Record<string, string> = {}, options: StoreOptions = {}) {
  const values = new Map(Object.entries(initial));
  const store: SecretStore = {
    available: () => options.available ?? true,
    read: () => Object.fromEntries(values),
    write: () => undefined,
    get: (key) => {
      if (options.failGet !== undefined) throw options.failGet;
      return values.get(key);
    },
    set: (key, value) => {
      if (options.failSet !== undefined) throw options.failSet;
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
  return { store, values };
}

describe('handleChildMessage', () => {
  it('returns a stored secret for secret.get', () => {
    const { child, messages } = createChild();
    const { store } = createStore({ openai: 'sk-test' });

    const reply = handleChildMessage(child, { id: 'r1', type: 'secret.get', key: 'openai' }, store);

    expect(reply).toEqual({ id: 'r1', ok: true, value: 'sk-test' });
    expect(messages).toEqual([{ id: 'r1', ok: true, value: 'sk-test' }]);
  });

  it('answers secret.get for a missing key without a value property', () => {
    const { child, messages } = createChild();
    const { store } = createStore();

    const reply = handleChildMessage(child, { id: 'r2', type: 'secret.get', key: 'openai' }, store);

    expect(reply).toEqual({ id: 'r2', ok: true });
    expect(reply).not.toHaveProperty('value');
    expect(messages).toEqual([{ id: 'r2', ok: true }]);
  });

  it('stores a secret for secret.set and never echoes the value', () => {
    const { child, messages } = createChild();
    const { store, values } = createStore();

    const reply = handleChildMessage(
      child,
      { id: 'r3', type: 'secret.set', key: 'openai', value: 'sk-test' },
      store,
    );

    expect(values.get('openai')).toBe('sk-test');
    expect(reply).toEqual({ id: 'r3', ok: true });
    expect(reply).not.toHaveProperty('value');
    expect(messages).toEqual([{ id: 'r3', ok: true }]);
  });

  it('rejects an unknown message type', () => {
    const { child, messages } = createChild();
    const { store } = createStore();

    const reply = handleChildMessage(
      child,
      { id: 'r4', type: 'secret.delete', key: 'openai' },
      store,
    );

    expect(reply).toEqual({ id: 'r4', ok: false, error: 'Unknown secret message type.' });
    expect(messages).toEqual([reply]);
  });

  it('rejects a request without a key', () => {
    const { child } = createChild();
    const { store } = createStore();

    expect(handleChildMessage(child, { id: 'r5', type: 'secret.get' }, store)).toEqual({
      id: 'r5',
      ok: false,
      error: 'The secret request is missing its key.',
    });
    expect(
      handleChildMessage(child, { id: 'r6', type: 'secret.set', value: 'sk-test' }, store),
    ).toEqual({ id: 'r6', ok: false, error: 'The secret request is missing its key.' });
  });

  it('refuses a non-string value from a misbehaving store', () => {
    const { child, messages } = createChild();
    const { store } = createStore();
    const broken: SecretStore = { ...store, get: () => 42 as unknown as string };

    const reply = handleChildMessage(
      child,
      { id: 'r16', type: 'secret.get', key: 'openai' },
      broken,
    );

    expect(reply).toEqual({ id: 'r16', ok: false, error: 'The secret could not be read.' });
    expect(messages).toEqual([reply]);
  });

  it('rejects a secret.set without a string value', () => {
    const { child } = createChild();
    const { store, values } = createStore();

    expect(
      handleChildMessage(child, { id: 'r7', type: 'secret.set', key: 'openai' }, store),
    ).toEqual({ id: 'r7', ok: false, error: 'The secret request is missing its value.' });
    expect(
      handleChildMessage(child, { id: 'r8', type: 'secret.set', key: 'openai', value: 42 }, store),
    ).toEqual({ id: 'r8', ok: false, error: 'The secret request is missing its value.' });
    expect(values.size).toBe(0);
  });

  it('ignores a message without a usable id', () => {
    const { child, messages } = createChild();
    const { store } = createStore();
    const { logger, calls } = createLogger();

    expect(
      handleChildMessage(child, { type: 'secret.get', key: 'openai' }, store, logger),
    ).toBeNull();
    expect(handleChildMessage(child, null, store, logger)).toBeNull();
    expect(handleChildMessage(child, 'secret.get', store, logger)).toBeNull();
    expect(messages).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it('refuses reads and writes when OS encryption is unavailable', () => {
    const { child, messages } = createChild();
    const { store, values } = createStore({ openai: 'sk-test' }, { available: false });

    const getReply = handleChildMessage(
      child,
      { id: 'r9', type: 'secret.get', key: 'openai' },
      store,
    );
    const setReply = handleChildMessage(
      child,
      { id: 'r10', type: 'secret.set', key: 'anthropic', value: 'sk-other' },
      store,
    );

    expect(getReply).toMatchObject({ id: 'r9', ok: false });
    expect(setReply).toMatchObject({ id: 'r10', ok: false });
    expect(getReply).toHaveProperty('error', expect.stringMatching(/encryption is unavailable/i));
    expect(values).toEqual(new Map([['openai', 'sk-test']]));
    expect(messages).toEqual([getReply, setReply]);
  });

  it('refuses a request when the store cannot report availability', () => {
    const { child, messages } = createChild();
    const { store } = createStore({ openai: 'sk-test' });
    const broken: SecretStore = {
      ...store,
      available: () => {
        throw new Error('keyring is locked');
      },
    };

    const reply = handleChildMessage(
      child,
      { id: 'r17', type: 'secret.get', key: 'openai' },
      broken,
    );

    expect(reply).toMatchObject({ id: 'r17', ok: false });
    expect(messages).toEqual([reply]);
  });

  it('never puts a secret value in a reply or a log line', () => {
    const secret = 'sk-super-secret-sentinel';
    const { child, messages } = createChild();
    const { store } = createStore({}, { failSet: new Error(secret) });
    const { logger, calls } = createLogger();

    handleChildMessage(
      child,
      { id: 'r11', type: 'secret.set', key: 'openai', value: secret },
      store,
      logger,
    );
    handleChildMessage(
      child,
      { id: 'r12', type: 'secret.set', key: 'openai', value: secret },
      createStore().store,
      logger,
    );

    expect(JSON.stringify(messages)).not.toContain(secret);
    expect(JSON.stringify(calls)).not.toContain(secret);
  });

  it('reports store failures without leaking their messages', () => {
    const { child } = createChild();
    const { store } = createStore({}, { failGet: new Error('sk-leaked-in-error') });
    const { logger, calls } = createLogger();

    const reply = handleChildMessage(
      child,
      { id: 'r13', type: 'secret.get', key: 'openai' },
      store,
      logger,
    );

    expect(reply).toMatchObject({ id: 'r13', ok: false });
    expect(JSON.stringify(reply)).not.toContain('sk-leaked-in-error');
    expect(JSON.stringify(calls)).not.toContain('sk-leaked-in-error');
  });

  it('does not throw when the child cannot receive the reply', () => {
    const { logger, calls } = createLogger();
    const child: SecretBridgeChild = {
      postMessage: () => {
        throw new Error('process is gone');
      },
    };
    const { store } = createStore({ openai: 'sk-test' });

    expect(() =>
      handleChildMessage(child, { id: 'r14', type: 'secret.get', key: 'openai' }, store, logger),
    ).not.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe('attachSecretBridge', () => {
  it('routes server messages through the secret store', () => {
    const messages: unknown[] = [];
    const listeners: Array<(message: unknown) => void> = [];
    const host = {
      postMessage: (message: unknown) => {
        messages.push(message);
      },
      on: (_event: 'message', listener: (message: unknown) => void) => {
        listeners.push(listener);
      },
    };
    const { store } = createStore({ openai: 'sk-test' });

    attachSecretBridge(host, store);

    expect(listeners).toHaveLength(1);
    listeners[0]?.({ id: 'r15', type: 'secret.get', key: 'openai' });
    expect(messages).toEqual([{ id: 'r15', ok: true, value: 'sk-test' }]);
  });
});
