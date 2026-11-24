/**
 * Electron's utility process delivers `process.parentPort` messages as a
 * `MessageEvent` whose payload is `.data` (Electron types `ParentPort.on('message')`
 * as `(messageEvent: MessageEvent) => void`). Node's `process.on('message')` and the
 * test seams deliver the payload itself, so both shapes have to work.
 */

/**
 * Unwraps a `MessageEvent` and leaves a raw payload untouched.
 *
 * A wrapper is recognised by its `data` member with either no `type` (a duck-typed
 * event) or `type: 'message'` (a real `MessageEvent`). Payloads that carry their own
 * `type` (every secret and shutdown message does) are never unwrapped.
 */
export function unwrapPortMessage(message: unknown): unknown {
  if (typeof message !== 'object' || message === null) return message;
  const record = message as Record<string, unknown>;
  if (!('data' in record)) return message;
  const type = record['type'];
  return type === undefined || type === 'message' ? record['data'] : message;
}

/** The shutdown request main sends before quitting, in either delivery shape. */
export function isShutdownMessage(message: unknown): boolean {
  const payload = unwrapPortMessage(message);
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    (payload as Record<string, unknown>)['type'] === 'shutdown'
  );
}
