import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError } from '../errors.js';
import { dispatch, type RpcHandlers } from '../rpc.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { createTerminalHandlers, TERMINAL_METHODS } from './handlers.js';
import { TerminalService } from './service.js';

describe('terminal handlers', () => {
  let ctx: TestContext;
  let service: TerminalService;
  let handlers: RpcHandlers;

  beforeEach(() => {
    ctx = createTestContext();
    service = new TerminalService({ repos: ctx.repos, onData: () => undefined });
    handlers = createTerminalHandlers(service);
  });

  afterEach(async () => {
    await service.disposeAll();
    ctx.dispose();
  });

  it('registers exactly the four terminal methods', () => {
    expect([...handlers.keys()].toSorted()).toEqual([...TERMINAL_METHODS].toSorted());
  });

  it('parses params with the contract schemas', () => {
    const open = handlers.get('terminal.open');
    expect(open).toBeDefined();
    expect(() => open?.({ threadId: 'thr_x', cols: 0, rows: 24 })).toThrow(RpcError);
    expect(() => open?.({ threadId: '', cols: 80, rows: 24 })).toThrow(RpcError);
  });

  it('maps an unknown terminal to not-found through dispatch', async () => {
    const response = await dispatch(handlers, {
      id: 'req_input',
      method: 'terminal.input',
      params: { terminalId: 'term_missing', data: 'ls\r' },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });

  it('rejects invalid params through dispatch', async () => {
    const response = await dispatch(handlers, {
      id: 'req_resize',
      method: 'terminal.resize',
      params: { terminalId: 'term_x', cols: 0, rows: 24 },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('bad-request');
  });

  it('reports an unknown thread on open', async () => {
    const response = await dispatch(handlers, {
      id: 'req_open',
      method: 'terminal.open',
      params: { threadId: 'thr_missing', cols: 80, rows: 24 },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });

  it('reports an unknown terminal on close', async () => {
    const response = await dispatch(handlers, {
      id: 'req_close',
      method: 'terminal.close',
      params: { terminalId: 'term_missing' },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });
});
