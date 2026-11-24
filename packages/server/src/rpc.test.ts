import { RPC_METHODS, type ServerEvent } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus } from './events.js';
import { RpcError } from './errors.js';
import { createRpcHandlers, dispatch, type RpcHandler, type RpcHandlers } from './rpc.js';
import { createTestContext, type TestContext } from './test-support.js';

const IMPLEMENTED = [
  'app.health',
  'checkpoints.create',
  'checkpoints.list',
  'checkpoints.revert',
  'diff.get',
  'git.commit',
  'git.pr',
  'git.push',
  'projects.add',
  'projects.list',
  'projects.refresh',
  'projects.remove',
  'settings.get',
  'settings.set',
  'threads.create',
  'threads.delete',
  'threads.events',
  'threads.get',
  'threads.list',
  'threads.update',
];

const DEFERRED = [
  'threads.send',
  'threads.interrupt',
  'threads.approve',
  'terminal.open',
  'terminal.input',
  'terminal.resize',
  'terminal.close',
  'providers.list',
  'providers.upsert',
  'providers.remove',
  'providers.test',
  'models.list',
  'brain.list',
  'brain.upsert',
  'brain.delete',
  'brain.preview',
  'council.start',
  'council.cancel',
  'council.status',
  'commands.list',
  'skills.list',
  'diagnostics.export',
];

interface HandlersFixture {
  ctx: TestContext;
  handlers: RpcHandlers;
  bus: EventBus;
}

function makeHandlers(): HandlersFixture {
  const ctx = createTestContext();
  const bus = createEventBus();
  const handlers = createRpcHandlers({
    repos: ctx.repos,
    bus,
    version: '0.1.0',
    startedAt: Date.now(),
    dbPath: ctx.env.root,
  });
  return { ctx, handlers, bus };
}

describe('rpc registry', () => {
  it('registers exactly the implemented methods and nothing else', () => {
    const { ctx, handlers } = makeHandlers();
    try {
      expect([...handlers.keys()].toSorted()).toEqual(IMPLEMENTED);
      for (const method of handlers.keys()) {
        expect(RPC_METHODS).toContain(method);
      }
      for (const method of DEFERRED) {
        expect(handlers.has(method)).toBe(false);
      }
    } finally {
      ctx.dispose();
    }
  });

  it('answers app.health with the process facts', async () => {
    const { ctx, handlers } = makeHandlers();
    try {
      const response = await dispatch(handlers, {
        id: 'health',
        method: 'app.health',
        params: {},
      });
      expect(response).toMatchObject({
        id: 'health',
        ok: true,
        result: { version: '0.1.0', pid: process.pid, dbPath: ctx.env.root },
      });
    } finally {
      ctx.dispose();
    }
  });

  it('rejects unknown methods and invalid params as bad-request', async () => {
    const { ctx, handlers } = makeHandlers();
    try {
      const unknown = await dispatch(handlers, {
        id: 'unknown',
        method: 'threads.send',
        params: {},
      });
      expect(unknown).toEqual({
        id: 'unknown',
        ok: false,
        error: { code: 'bad-request', message: 'unknown method: threads.send' },
      });

      const invalid = await dispatch(handlers, {
        id: 'invalid',
        method: 'projects.add',
        params: {},
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.error.code).toBe('bad-request');
    } finally {
      ctx.dispose();
    }
  });

  it('maps RpcError codes and hides unexpected errors', async () => {
    const notFoundHandlers: RpcHandlers = new Map<string, RpcHandler>([
      [
        'app.health',
        () => {
          throw new RpcError('not-found', 'missing thing');
        },
      ],
    ]);
    expect(await dispatch(notFoundHandlers, { id: 'a', method: 'app.health', params: {} })).toEqual(
      { id: 'a', ok: false, error: { code: 'not-found', message: 'missing thing' } },
    );

    const crashingHandlers: RpcHandlers = new Map<string, RpcHandler>([
      [
        'app.health',
        () => {
          throw new Error('secret stack at C:/tmp/private.ts');
        },
      ],
    ]);
    const internal = await dispatch(crashingHandlers, {
      id: 'b',
      method: 'app.health',
      params: {},
    });
    expect(internal).toEqual({
      id: 'b',
      ok: false,
      error: { code: 'internal', message: 'internal error' },
    });
    expect(JSON.stringify(internal)).not.toContain('secret');
  });

  it('rejects a handler result that does not match the contract', async () => {
    const badHandlers: RpcHandlers = new Map<string, RpcHandler>([
      ['app.health', () => ({ version: 1 })],
    ]);
    expect(await dispatch(badHandlers, { id: 'c', method: 'app.health', params: {} })).toEqual({
      id: 'c',
      ok: false,
      error: { code: 'internal', message: 'handler returned an invalid result' },
    });
  });

  it('persists settings and broadcasts the change', async () => {
    const { ctx, handlers, bus } = makeHandlers();
    try {
      const events: ServerEvent[] = [];
      bus.subscribe((event) => events.push(event));
      const response = await dispatch(handlers, {
        id: 'set',
        method: 'settings.set',
        params: { patch: { theme: 'light' } },
      });
      expect(response.ok).toBe(true);
      expect(ctx.repos.settings.get().theme).toBe('light');
      expect(events.some((event) => event.type === 'settings.updated')).toBe(true);
    } finally {
      ctx.dispose();
    }
  });
});
