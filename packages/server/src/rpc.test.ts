import type { AdapterSession, Message, ServerEvent } from '@tuffcode/contracts';
import { AdapterUnavailableError, RPC_METHODS } from '@tuffcode/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createCommandHandlers } from './commands/handlers.js';
import { createEventBus, type EventBus } from './events.js';
import { RpcError } from './errors.js';
import { createProvidersService } from './providers/service.js';
import { createRpcHandlers, dispatch, type RpcHandler, type RpcHandlers } from './rpc.js';
import { createRunner, type Runner } from './runner/runner.js';
import { createSecretBridge } from './secrets/bridge.js';
import { createSkillHandlers } from './skills/handlers.js';
import { createTestContext, silentLogger, type TestContext } from './test-support.js';

const IMPLEMENTED = [
  'app.health',
  'brain.delete',
  'brain.list',
  'brain.preview',
  'brain.upsert',
  'checkpoints.create',
  'checkpoints.list',
  'checkpoints.revert',
  'commands.list',
  'diagnostics.export',
  'diff.get',
  'git.commit',
  'git.pr',
  'git.push',
  'messages.list',
  'models.list',
  'projects.add',
  'projects.list',
  'projects.refresh',
  'projects.remove',
  'providers.list',
  'providers.remove',
  'providers.test',
  'providers.upsert',
  'settings.get',
  'settings.set',
  'skills.list',
  'threads.approve',
  'threads.create',
  'threads.delete',
  'threads.events',
  'threads.get',
  'threads.interrupt',
  'threads.list',
  'threads.send',
  'threads.update',
];

const DEFERRED = ['council.start', 'council.cancel', 'council.status'];

const TERMINAL = ['terminal.open', 'terminal.input', 'terminal.resize', 'terminal.close'];

interface HandlersFixture {
  ctx: TestContext;
  handlers: RpcHandlers;
  bus: EventBus;
  runner: Runner;
  events: ServerEvent[];
}

function makeHandlers(options: {
  createAdapter?: () => Promise<AdapterSession>;
  featureHandlers?: readonly RpcHandlers[];
} = {}): HandlersFixture {
  const ctx = createTestContext();
  const bus = createEventBus();
  const events: ServerEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const secrets = createSecretBridge(undefined);
  const providers = createProvidersService({
    repos: ctx.repos,
    bus,
    secrets,
    resolveCommand: async () => null,
  });
  const runner = createRunner({
    repos: ctx.repos,
    bus,
    logger: silentLogger(),
    secrets,
    settings: () => ctx.repos.settings.get(),
    createAdapter:
      options.createAdapter ??
      (async () => {
        throw new AdapterUnavailableError('prv_test', 'install the CLI');
      }),
  });
  const commands: RpcHandlers = new Map([
    ...createCommandHandlers({ repos: ctx.repos, bus }),
    ...createSkillHandlers({ repos: ctx.repos, bus }),
  ]);
  const handlers = createRpcHandlers({
    repos: ctx.repos,
    bus,
    version: '0.1.0',
    startedAt: Date.now(),
    dbPath: ctx.env.root,
    runner,
    providers,
    brain: { repos: ctx.repos },
    commands,
    diagnostics: {
      version: '0.1.0',
      startedAt: Date.now(),
      dbPath: ctx.env.root,
      repos: ctx.repos,
      runner,
      warnings: () => [],
      secretBridgeAvailable: false,
    },
    featureHandlers: options.featureHandlers ?? [],
  });
  return { ctx, handlers, bus, runner, events };
}

describe('rpc registry', () => {
  const fixtures: HandlersFixture[] = [];

  function fixture(options: Parameters<typeof makeHandlers>[0] = {}): HandlersFixture {
    const built = makeHandlers(options);
    fixtures.push(built);
    return built;
  }

  afterEach(async () => {
    for (const built of fixtures.splice(0)) {
      await built.runner.disposeAll();
      built.ctx.dispose();
    }
  });

  it('registers exactly the implemented methods and nothing else', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()].toSorted()).toEqual(IMPLEMENTED);
    for (const method of handlers.keys()) {
      expect(RPC_METHODS).toContain(method);
    }
    for (const method of [...DEFERRED, ...TERMINAL]) {
      expect(handlers.has(method)).toBe(false);
    }
  });

  it('registers injected feature handlers and rejects duplicate methods at startup', () => {
    const pty: RpcHandlers = new Map<string, RpcHandler>([
      ['terminal.open', () => ({ terminalId: 'term_1' })],
    ]);
    const { handlers } = fixture({ featureHandlers: [pty] });
    expect(handlers.has('terminal.open')).toBe(true);
    expect(handlers.has('terminal.input')).toBe(false);

    expect(() =>
      makeHandlers({
        featureHandlers: [new Map<string, RpcHandler>([['app.health', () => ({})]])],
      }),
    ).toThrow('duplicate RPC method registration: app.health');
  });

  it('answers app.health with the process facts', async () => {
    const { ctx, handlers } = fixture();
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
  });

  it('rejects unknown methods and invalid params as bad-request', async () => {
    const { handlers } = fixture();
    const unknown = await dispatch(handlers, {
      id: 'unknown',
      method: 'council.start',
      params: {},
    });
    expect(unknown).toEqual({
      id: 'unknown',
      ok: false,
      error: { code: 'bad-request', message: 'unknown method: council.start' },
    });

    const invalid = await dispatch(handlers, {
      id: 'invalid',
      method: 'projects.add',
      params: {},
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('bad-request');
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
    const { ctx, handlers, bus } = fixture();
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
  });

  it('lists thread messages in order and rejects an unknown thread', async () => {
    const { ctx, handlers } = fixture();
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: new Date().toISOString(),
    });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'thread',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: null,
      branch: null,
      baseBranch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ctx.repos.messages.add({
      id: 'msg_2',
      threadId: 'thr_a',
      role: 'assistant',
      content: 'second',
      createdAt: '2026-11-24T10:00:02.000Z',
    });
    ctx.repos.messages.add({
      id: 'msg_1',
      threadId: 'thr_a',
      role: 'user',
      content: 'first',
      createdAt: '2026-11-24T10:00:01.000Z',
    });

    const listed = await dispatch(handlers, {
      id: 'list',
      method: 'messages.list',
      params: { threadId: 'thr_a' },
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const messages = listed.result as Message[];
      expect(messages.map((message) => message.id)).toEqual(['msg_1', 'msg_2']);
    }

    const missing = await dispatch(handlers, {
      id: 'missing',
      method: 'messages.list',
      params: { threadId: 'thr_missing' },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('not-found');
  });

  it('returns a turn id from threads.send while the run is still in flight', async () => {
    const { promise: release, resolve } = Promise.withResolvers<void>();
    const adapter: AdapterSession = {
      id: 'sess_rpc',
      providerId: 'prv_test',
      capabilities: { tools: true, approvals: true, resume: false, models: false },
      send: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await release;
            return { done: true, value: undefined };
          },
        }),
      }),
      approve: () => undefined,
      interrupt: async () => undefined,
      dispose: async () => undefined,
    };
    const { ctx, handlers } = fixture({ createAdapter: async () => adapter });
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: new Date().toISOString(),
    });
    ctx.repos.providers.upsert({ id: 'prv_test', kind: 'claude', label: 'Test', config: {} });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'thread',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: ctx.env.root,
      branch: null,
      baseBranch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await dispatch(handlers, {
      id: 'send',
      method: 'threads.send',
      params: { id: 'thr_a', text: 'hello' },
    });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toEqual({ turnId: expect.stringMatching(/^turn_/) });
    }
    expect(ctx.repos.threads.get('thr_a')?.status).toBe('running');
    resolve();
  });

  it('reports a provider-unavailable failure through threads.send', async () => {
    const { ctx, handlers } = fixture();
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: new Date().toISOString(),
    });
    ctx.repos.providers.upsert({ id: 'prv_test', kind: 'claude', label: 'Test', config: {} });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'thread',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: ctx.env.root,
      branch: null,
      baseBranch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await dispatch(handlers, {
      id: 'send',
      method: 'threads.send',
      params: { id: 'thr_a', text: 'hello' },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('provider-unavailable');
      expect(response.error.message).toContain('install the CLI');
    }
    expect(ctx.repos.threads.get('thr_a')?.status).toBe('failed');
  });
});
