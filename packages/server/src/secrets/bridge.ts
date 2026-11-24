import { z } from 'zod';
import { newId } from '@tuffcode/shared';

/**
 * The Electron main-process side of the secret bridge. `utilityProcess.parentPort`
 * satisfies this shape; the interface keeps the bridge testable without Electron.
 */
export interface SecretPort {
  postMessage(message: unknown): void;
  on(event: 'message' | 'close', listener: (message?: unknown) => void): void;
  off?(event: 'message' | 'close', listener: (message?: unknown) => void): void;
  start?(): void;
}

export interface SecretBridgeOptions {
  /** Per-request timeout. Tests lower it; production uses five seconds. */
  timeoutMs?: number;
}

/**
 * What the rest of the server sees. `available` is false when no parent port
 * exists, which is a normal state for plain Node runs and tests.
 */
export interface Secrets {
  readonly available: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const UNAVAILABLE = 'secret storage unavailable';

/** The reply main sends back. Anything that does not parse is ignored. */
const SecretResultSchema = z.object({
  id: z.string(),
  type: z.literal('secret.result'),
  ok: z.boolean(),
  value: z.string().nullish(),
  error: z.string().optional(),
});

interface PendingRequest {
  readonly kind: 'get' | 'set';
  readonly resolve: (value: string | null) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Request/response client for the Electron safeStorage bridge. Requests are exactly
 * `{id, type: 'secret.get' | 'secret.set', key, value?}`; main answers with
 * `{id, type: 'secret.result', ok, value?, error?}`. Values never reach a log, an
 * event, the database, or an RPC result, and there is no plaintext fallback.
 */
export function createSecretBridge(
  port: SecretPort | undefined,
  options: SecretBridgeOptions = {},
): Secrets {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, PendingRequest>();
  let disposed = false;

  function rejectAll(message: string): void {
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
  }

  function onMessage(message: unknown): void {
    const parsed = SecretResultSchema.safeParse(message);
    if (!parsed.success) return;
    const result = parsed.data;
    const entry = pending.get(result.id);
    if (entry === undefined) return;
    pending.delete(result.id);
    clearTimeout(entry.timer);
    if (!result.ok) {
      const error = result.error ?? 'secret request failed';
      if (entry.kind === 'get') entry.resolve(null);
      else entry.reject(new Error(error));
      return;
    }
    const value = result.value;
    entry.resolve(typeof value === 'string' && value.length > 0 ? value : null);
  }

  function onClose(): void {
    rejectAll('secret bridge closed');
  }

  if (port !== undefined) {
    port.on('message', onMessage);
    port.on('close', onClose);
    port.start?.();
  }

  function request(kind: 'get' | 'set', key: string, value?: string): Promise<string | null> {
    if (port === undefined) {
      return kind === 'get' ? Promise.resolve(null) : Promise.reject(new Error(UNAVAILABLE));
    }
    if (disposed) return Promise.reject(new Error('secret bridge disposed'));
    const id = newId('sec');
    const { promise, resolve, reject } = Promise.withResolvers<string | null>();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`secret ${kind} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();
    pending.set(id, { kind, resolve, reject, timer });
    try {
      port.postMessage(
        kind === 'get'
          ? { id, type: 'secret.get', key }
          : { id, type: 'secret.set', key, value: value ?? '' },
      );
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error('secret request failed'));
    }
    return promise;
  }

  return {
    available: port !== undefined,
    get: (key) => request('get', key),
    set: async (key, value) => {
      await request('set', key, value);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      rejectAll('secret bridge disposed');
      port?.off?.('message', onMessage);
      port?.off?.('close', onClose);
    },
  };
}
