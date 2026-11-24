import type { RpcErrorCode } from '@tuffcode/contracts';

/**
 * An error a handler raises on purpose. The WS layer turns it into the matching
 * contract error code; any other thrown value becomes a generic `internal` error so
 * stack traces and SQL details never reach the renderer.
 */
export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly details: unknown;

  constructor(code: RpcErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.details = details;
  }
}

export function notFound(message: string): RpcError {
  return new RpcError('not-found', message);
}

export function badRequest(message: string): RpcError {
  return new RpcError('bad-request', message);
}

export function conflict(message: string): RpcError {
  return new RpcError('conflict', message);
}
