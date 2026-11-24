import { methods, type RpcParams } from '@tuffcode/contracts';
import { badRequest } from '../errors.js';
import type { RpcHandler, RpcHandlers } from '../rpc.js';
import type { TerminalService } from './service.js';

/** The terminal methods this slice owns; the glue layer registers exactly these. */
export const TERMINAL_METHODS = [
  'terminal.open',
  'terminal.input',
  'terminal.resize',
  'terminal.close',
] as const;

export type TerminalMethod = (typeof TERMINAL_METHODS)[number];

function parseParams<M extends TerminalMethod>(method: M, params: unknown): RpcParams<M> {
  const parsed = methods[method].params.safeParse(params);
  if (!parsed.success) throw badRequest(`invalid ${method} params`);
  return parsed.data as RpcParams<M>;
}

/**
 * Builds the `terminal.*` handler map over a live service. Params are parsed with the
 * contract schemas here as well as in `dispatch`, so the map is safe to register or
 * call on its own.
 */
export function createTerminalHandlers(service: TerminalService): RpcHandlers {
  const handlers = new Map<string, RpcHandler>();

  handlers.set('terminal.open', (params) => {
    const { threadId, cols, rows } = parseParams('terminal.open', params);
    return service.open(threadId, cols, rows);
  });
  handlers.set('terminal.input', (params) => {
    const { terminalId, data } = parseParams('terminal.input', params);
    service.input(terminalId, data);
    return {};
  });
  handlers.set('terminal.resize', (params) => {
    const { terminalId, cols, rows } = parseParams('terminal.resize', params);
    service.resize(terminalId, cols, rows);
    return {};
  });
  handlers.set('terminal.close', async (params) => {
    const { terminalId } = parseParams('terminal.close', params);
    await service.close(terminalId);
    return {};
  });

  return handlers;
}
