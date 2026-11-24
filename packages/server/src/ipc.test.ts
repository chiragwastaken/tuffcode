import { describe, expect, it } from 'vitest';
import { isShutdownMessage, unwrapPortMessage } from './ipc.js';

describe('parent port messages', () => {
  it('unwraps a MessageEvent and leaves a raw payload untouched', () => {
    const event = new MessageEvent('message', { data: { id: 'sec_1', ok: true } });
    expect(unwrapPortMessage(event)).toEqual({ id: 'sec_1', ok: true });

    const raw = { id: 'sec_1', type: 'secret.result', ok: true };
    expect(unwrapPortMessage(raw)).toBe(raw);

    // A duck-typed event: `data` with no `type`.
    expect(unwrapPortMessage({ data: { type: 'shutdown' } })).toEqual({ type: 'shutdown' });
    // A payload with its own `data` member and an unrelated type is not an event.
    const payload = { type: 'secret.result', data: 'kept' };
    expect(unwrapPortMessage(payload)).toBe(payload);

    expect(unwrapPortMessage(undefined)).toBeUndefined();
    expect(unwrapPortMessage('shutdown')).toBe('shutdown');
  });

  it('recognises shutdown in both delivery shapes', () => {
    expect(isShutdownMessage({ type: 'shutdown' })).toBe(true);
    expect(isShutdownMessage(new MessageEvent('message', { data: { type: 'shutdown' } }))).toBe(
      true,
    );
    expect(isShutdownMessage({ data: { type: 'shutdown' } })).toBe(true);

    expect(isShutdownMessage(new MessageEvent('message', { data: { type: 'ready', port: 1 } }))).toBe(
      false,
    );
    expect(isShutdownMessage({ type: 'ready', port: 1 })).toBe(false);
    expect(isShutdownMessage(new MessageEvent('message', { data: 'shutdown' }))).toBe(false);
    expect(isShutdownMessage(undefined)).toBe(false);
    expect(isShutdownMessage(null)).toBe(false);
  });
});
