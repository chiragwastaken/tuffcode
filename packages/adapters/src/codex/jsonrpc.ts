import { StringDecoder } from 'node:string_decoder';
import type { AdapterLogger } from '@tuffcode/contracts';
import { isRecord } from './guards.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './protocol.js';

export type RpcId = string | number;

export interface RpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * One decoded JSONL frame. Server requests carry an id and a method; responses
 * carry an id plus result or error; notifications carry only a method.
 */
export type RpcMessage =
  | { kind: 'response'; id: RpcId; result: unknown }
  | { kind: 'error'; id: RpcId; error: RpcErrorBody }
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'request'; id: RpcId; method: string; params: unknown };

export class RpcRequestError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data: unknown;

  constructor(method: string, code: number, message: string, data?: unknown) {
    super(`codex rpc ${method} failed: ${message}`);
    this.name = 'RpcRequestError';
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

export class RpcTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`codex rpc ${method} timed out after ${timeoutMs}ms`);
    this.name = 'RpcTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class RpcClosedError extends Error {
  readonly method: string;
  readonly reason: string;

  constructor(method: string, reason: string) {
    super(`codex rpc ${method} failed: ${reason}`);
    this.name = 'RpcClosedError';
    this.method = method;
    this.reason = reason;
  }
}

export interface JsonlRpcHandlers {
  onNotification(method: string, params: unknown): void;
  onRequest(id: RpcId, method: string, params: unknown): void;
  onClose(reason: string): void;
}

export interface JsonlRpcClientOptions {
  /** Child stdout: newline-delimited JSON from the app-server. */
  input: NodeJS.ReadableStream;
  /** Child stdin: newline-delimited JSON to the app-server. */
  output: NodeJS.WritableStream;
  handlers: JsonlRpcHandlers;
  requestTimeoutMs?: number;
  logger?: AdapterLogger;
}

export interface JsonlRpcClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: RpcId, result: unknown): void;
  respondError(id: RpcId, code: number, message: string, data?: unknown): void;
  dispose(reason?: string): void;
  isClosed(): boolean;
}

function readId(value: unknown): RpcId | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function readErrorBody(value: unknown): RpcErrorBody | null {
  if (!isRecord(value)) return null;
  if (typeof value.code !== 'number' || typeof value.message !== 'string') return null;
  return { code: value.code, message: value.message, data: value.data };
}

/**
 * Parse one JSONL line into an RPC frame. Returns null for blank lines,
 * malformed JSON, and objects that are not RPC frames so a noisy app-server
 * cannot take the adapter down.
 */
export function parseRpcMessage(line: string): RpcMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const method = typeof value.method === 'string' && value.method.length > 0 ? value.method : null;
  const id = readId(value.id);

  if (method !== null && id !== null) {
    return { kind: 'request', id, method, params: value.params };
  }
  if (method !== null) {
    return { kind: 'notification', method, params: value.params };
  }
  if (id === null) return null;

  if ('error' in value) {
    const error = readErrorBody(value.error);
    return error === null ? null : { kind: 'error', id, error };
  }
  if ('result' in value) {
    return { kind: 'response', id, result: value.result };
  }
  return null;
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Minimal newline-delimited JSON-RPC client over a pair of streams. It owns
 * request ids, the pending map, per-request deadlines, and frame parsing.
 */
export function createJsonlRpcClient(options: JsonlRpcClientOptions): JsonlRpcClient {
  const { input, output, handlers, logger } = options;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const pending = new Map<number, PendingRequest>();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let nextId = 1;
  let closed = false;

  const detach = () => {
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('close', onEnd);
    input.removeListener('error', onStreamError);
    output.removeListener('error', onStreamError);
  };

  const failPending = (reason: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new RpcClosedError(request.method, reason));
    }
    pending.clear();
  };

  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    failPending(reason);
    detach();
    handlers.onClose(reason);
  };

  function onStreamError(): void {
    close('stream error');
  }

  function onEnd(): void {
    close('stream closed');
  }

  const handleFrame = (line: string) => {
    const message = parseRpcMessage(line);
    if (message === null) {
      if (line.trim().length > 0) {
        logger?.debug('codex rpc ignored malformed frame', { bytes: line.length });
      }
      return;
    }

    if (message.kind === 'notification') {
      try {
        handlers.onNotification(message.method, message.params);
      } catch {
        logger?.error('codex rpc notification handler failed');
      }
      return;
    }

    if (message.kind === 'request') {
      try {
        handlers.onRequest(message.id, message.method, message.params);
      } catch {
        logger?.error('codex rpc request handler failed');
      }
      return;
    }

    if (typeof message.id !== 'number') return;
    const request = pending.get(message.id);
    if (request === undefined) {
      logger?.debug('codex rpc response without pending request');
      return;
    }
    pending.delete(message.id);
    clearTimeout(request.timer);

    if (message.kind === 'response') {
      request.resolve(message.result);
      return;
    }
    request.reject(
      new RpcRequestError(request.method, message.error.code, message.error.message, message.error.data),
    );
  };

  function onData(chunk: Buffer | string): void {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleFrame(line);
      index = buffer.indexOf('\n');
    }
  }

  const write = (frame: Record<string, unknown>): void => {
    if (closed) throw new RpcClosedError('write', 'client closed');
    output.write(`${JSON.stringify(frame)}\n`);
  };

  input.on('data', onData);
  input.on('end', onEnd);
  input.on('close', onEnd);
  input.on('error', onStreamError);
  output.on('error', onStreamError);

  return {
    request(method, params) {
      if (closed) return Promise.reject(new RpcClosedError(method, 'client closed'));

      const id = nextId;
      nextId += 1;

      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new RpcTimeoutError(method, requestTimeoutMs));
        }, requestTimeoutMs);
        timer.unref?.();

        pending.set(id, { method, resolve, reject, timer });

        try {
          write(params === undefined ? { id, method } : { id, method, params });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error instanceof Error ? error : new RpcClosedError(method, 'write failed'));
        }
      });
    },

    notify(method, params) {
      if (closed) return;
      try {
        write(params === undefined ? { method } : { method, params });
      } catch {
        // The close path already rejected every pending request.
      }
    },

    respond(id, result) {
      if (closed) return;
      try {
        write({ id, result });
      } catch {
        // The close path already rejected every pending request.
      }
    },

    respondError(id, code, message, data) {
      if (closed) return;
      try {
        write({ id, error: data === undefined ? { code, message } : { code, message, data } });
      } catch {
        // The close path already rejected every pending request.
      }
    },

    dispose(reason = 'client disposed') {
      if (closed) return;
      closed = true;
      failPending(reason);
      detach();
    },

    isClosed() {
      return closed;
    },
  };
}
