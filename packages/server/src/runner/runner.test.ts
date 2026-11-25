import { join } from 'node:path';
import type {
  AdapterEvent,
  AdapterSession,
  ApprovalChoice,
  ServerEvent,
  ThreadStatus,
  TurnContext,
} from '@tuffcode/contracts';
import { BASE_SYSTEM_PROMPT } from '@tuffcode/prompt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../db/repos/index.js';
import { createEventBus, type EventBus } from '../events.js';
import { planPrompt } from '../prompt/service.js';
import { createSecretBridge } from '../secrets/bridge.js';
import { createTestContext, silentLogger, type TestContext } from '../test-support.js';
import { createRunner, INTERRUPTED_MARKER, recordTurnStart, type Runner } from './runner.js';

const ISO = '2026-11-24T10:00:00.000Z';

interface SendCall {
  text: string;
  ctx: TurnContext;
}

/**
 * A queue-driven adapter: the test pushes events, the runner consumes them in order,
 * and `approve`/`interrupt` are observable without any vendor process.
 */
class FakeAdapter implements AdapterSession {
  readonly id = 'sess_fake';
  readonly providerId = 'prv_test';
  readonly capabilities = { tools: true, approvals: true, resume: false, models: false };
  readonly sends: SendCall[] = [];
  readonly approvals: { approvalId: string; decision: ApprovalChoice }[] = [];
  interrupts = 0;
  disposes = 0;
  compactCalls = 0;

  private queue: AdapterEvent[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;
  private failure: Error | null = null;
  private lastTurnId = 'turn_unknown';

  send(text: string, ctx: TurnContext): AsyncIterable<AdapterEvent> {
    this.sends.push({ text, ctx });
    this.lastTurnId = ctx.turnId;
    this.closed = false;
    return {
      [Symbol.asyncIterator]: () => this.iterate(),
    };
  }

  private iterate(): AsyncIterator<AdapterEvent> {
    return {
      next: async () => {
        if (this.failure !== null) throw this.failure;
        while (this.queue.length === 0 && !this.closed) {
          const { promise, resolve } = Promise.withResolvers<void>();
          this.waiter = resolve;
          await promise;
        }
        const event = this.queue.shift();
        if (event === undefined) return { done: true, value: undefined };
        if (event.type === 'turn.finished') this.closed = true;
        return { done: false, value: event };
      },
    };
  }

  push(...events: AdapterEvent[]): void {
    this.queue.push(...events);
    this.wake();
  }

  fail(message: string): void {
    this.failure = new Error(message);
    this.wake();
  }

  end(): void {
    this.closed = true;
    this.wake();
  }

  approve(approvalId: string, decision: ApprovalChoice): void {
    this.approvals.push({ approvalId, decision });
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1;
    this.push({ type: 'turn.finished', turnId: this.lastTurnId, reason: 'interrupted' });
    this.end();
  }

  async compact(): Promise<{ removed: number }> {
    this.compactCalls += 1;
    return { removed: 2 };
  }

  async dispose(): Promise<void> {
    this.disposes += 1;
    this.end();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }
}

function waitFor(bus: EventBus, predicate: (event: ServerEvent) => boolean): Promise<ServerEvent> {
  const { promise, resolve } = Promise.withResolvers<ServerEvent>();
  const unsubscribe = bus.subscribe((event) => {
    if (!predicate(event)) return;
    unsubscribe();
    resolve(event);
  });
  return promise;
}

function waitForTurnEnd(bus: EventBus): Promise<ServerEvent> {
  return waitFor(
    bus,
    (event) => event.type === 'thread.event' && event.payload.type === 'turn.finished',
  );
}

function contextEvents(events: readonly ServerEvent[]): ContextUpdatedEvent[] {
  return events.filter((event): event is ContextUpdatedEvent => event.type === 'context.updated');
}

type ContextUpdatedEvent = Extract<ServerEvent, { type: 'context.updated' }>;

interface Fixture {
  ctx: TestContext;
  bus: EventBus;
  runner: Runner;
  adapter: FakeAdapter;
  adapterCalls: { provider: ProviderRecord; secret: string | null }[];
  events: ServerEvent[];
  threadStatus(): ThreadStatus;
  turnStatus(turnId: string): string | undefined;
}

describe('thread runner', () => {
  let fixtures: Fixture[] = [];

  function setup(options: { providerEnabled?: boolean; adapter?: FakeAdapter } = {}): Fixture {
    const ctx = createTestContext();
    const bus = createEventBus();
    const events: ServerEvent[] = [];
    bus.subscribe((event) => events.push(event));
    ctx.repos.projects.add({
      id: 'prj_a',
      name: 'alpha',
      path: ctx.env.root,
      defaultBranch: 'main',
      createdAt: ISO,
    });
    ctx.repos.providers.upsert({
      id: 'prv_test',
      kind: 'claude',
      label: 'Test',
      config: {},
      enabled: options.providerEnabled ?? true,
    });
    ctx.repos.threads.create({
      id: 'thr_a',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'alpha thread',
      providerId: 'prv_test',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: ctx.env.root,
      branch: 'tuffcode/thr_a',
      baseBranch: 'main',
      createdAt: ISO,
      updatedAt: ISO,
    });
    const adapter = options.adapter ?? new FakeAdapter();
    const adapterCalls: { provider: ProviderRecord; secret: string | null }[] = [];
    const runner = createRunner({
      repos: ctx.repos,
      bus,
      logger: silentLogger(),
      secrets: createSecretBridge(undefined),
      settings: () => ctx.repos.settings.get(),
      createAdapter: async (provider, secret) => {
        adapterCalls.push({ provider, secret });
        return adapter;
      },
    });
    const fixture: Fixture = {
      ctx,
      bus,
      runner,
      adapter,
      adapterCalls,
      events,
      threadStatus: () => ctx.repos.threads.get('thr_a')?.status ?? 'idle',
      turnStatus: (turnId) => ctx.repos.turns.get(turnId)?.status,
    };
    fixtures.push(fixture);
    return fixture;
  }

  beforeEach(() => {
    fixtures = [];
  });

  afterEach(async () => {
    for (const fixture of fixtures) {
      await fixture.runner.disposeAll();
      fixture.ctx.dispose();
    }
    fixtures = [];
  });

  it('persists every event in order before broadcasting and writes one assistant message', async () => {
    const f = setup();
    const ended = waitForTurnEnd(f.bus);

    const { turnId } = await f.runner.send('thr_a', 'hello');
    expect(turnId).toMatch(/^turn_/);

    f.adapter.push(
      { type: 'turn.started', turnId },
      { type: 'text.delta', turnId, text: 'hello ' },
      { type: 'text.delta', turnId, text: 'world' },
      { type: 'turn.finished', turnId, reason: 'complete' },
    );
    await ended;

    const rows = f.ctx.repos.events.since('thr_a', 0, 100);
    expect(rows.map((row) => row.type)).toEqual([
      'turn.started',
      'text.delta',
      'text.delta',
      'turn.finished',
    ]);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4]);

    const broadcasts = f.events.filter(
      (event): event is Extract<ServerEvent, { type: 'thread.event' }> =>
        event.type === 'thread.event',
    );
    expect(broadcasts.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    for (const broadcast of broadcasts) {
      const stored = f.ctx.repos.events.since('thr_a', broadcast.seq - 1, 1)[0];
      expect(stored?.payload).toEqual(broadcast.payload);
    }

    expect(f.threadStatus()).toBe('ready-to-review');
    expect(f.turnStatus(turnId)).toBe('complete');
    const messages = f.ctx.repos.messages.list('thr_a');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.content).toBe('hello world');
  });

  it('persists exactly one user row per turn and one assistant row when it completes', async () => {
    const f = setup();
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    const sent = f.ctx.repos.messages.list('thr_a');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: `msg_${turnId}_user`, role: 'user', content: 'hello' });

    f.adapter.push(
      { type: 'text.delta', turnId, text: 'a' },
      { type: 'text.delta', turnId, text: 'b' },
      { type: 'turn.finished', turnId, reason: 'complete' },
    );
    await ended;

    const stored = f.ctx.repos.messages.list('thr_a');
    expect(stored.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(stored[1]).toMatchObject({ id: `msg_${turnId}_assistant`, content: 'ab' });
  });

  it('passes the enabled tools and iteration cap from settings into the turn', async () => {
    const f = setup();
    f.ctx.repos.settings.patch({ enabledTools: ['read'], maxToolIterations: 7 });
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    const ctx = f.adapter.sends[0]?.ctx;
    expect(ctx?.toolAllowlist).toEqual(['read']);
    expect(ctx?.maxToolIterations).toBe(7);

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
  });

  it('passes the settings output cap into the turn', async () => {
    const f = setup();
    f.ctx.repos.settings.patch({ maxOutputTokens: 4096 });
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    expect(f.adapter.sends[0]?.ctx.maxOutputTokens).toBe(4096);

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
  });

  it('lets a per-model output cap override the settings default', async () => {
    const f = setup();
    f.ctx.repos.providers.upsert({
      id: 'prv_test',
      kind: 'claude',
      label: 'Test',
      config: { models: [{ id: 'model-x', label: 'Model X', maxOutputTokens: 2048 }] },
    });
    f.ctx.repos.settings.patch({ maxOutputTokens: 4096 });
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    expect(f.adapter.sends[0]?.ctx.maxOutputTokens).toBe(2048);

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
  });

  it('emits context.updated before and after a turn', async () => {
    const f = setup();
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    const before = contextEvents(f.events);
    expect(before).toHaveLength(1);
    expect(before[0]?.payload).toMatchObject({ threadId: 'thr_a', compacted: false });

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;

    await vi.waitFor(() => expect(contextEvents(f.events)).toHaveLength(2));
    const after = contextEvents(f.events);
    expect(after[1]?.payload.compacted).toBe(false);
    expect(after[1]?.payload.usedTokens).toBeGreaterThan(0);
  });

  it('compacts once before a turn when usage crosses the warning threshold', async () => {
    const f = setup();
    f.ctx.repos.providers.upsert({
      id: 'prv_test',
      kind: 'claude',
      label: 'Test',
      config: { contextWindow: 100 },
    });
    f.ctx.repos.settings.patch({ contextWarningThreshold: 0.5, autoCompact: true });
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    expect(f.adapter.compactCalls).toBe(1);
    const compacted = contextEvents(f.events).filter((event) => event.payload.compacted);
    expect(compacted).toHaveLength(1);

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
  });

  it('leaves history alone when auto-compaction is off', async () => {
    const f = setup();
    f.ctx.repos.providers.upsert({
      id: 'prv_test',
      kind: 'claude',
      label: 'Test',
      config: { contextWindow: 100 },
    });
    f.ctx.repos.settings.patch({ contextWarningThreshold: 0.5, autoCompact: false });
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    expect(f.adapter.compactCalls).toBe(0);
    expect(contextEvents(f.events).some((event) => event.payload.compacted)).toBe(false);

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
  });

  it('does not duplicate the user row when the turn start is replayed', async () => {
    const f = setup();
    const { turnId } = await f.runner.send('thr_a', 'hello');
    f.adapter.end();

    recordTurnStart(f.ctx.repos, {
      threadId: 'thr_a',
      turnId,
      text: 'hello',
      injectedIds: [],
      createdAt: ISO,
    });

    expect(f.ctx.repos.messages.list('thr_a')).toHaveLength(1);
  });

  it('stores streamed text with a marker when the turn is interrupted', async () => {
    const f = setup();
    const { turnId } = await f.runner.send('thr_a', 'long job');
    const delta = waitFor(
      f.bus,
      (event) => event.type === 'thread.event' && event.payload.type === 'text.delta',
    );
    f.adapter.push({ type: 'text.delta', turnId, text: 'partial answer' });
    await delta;

    await f.runner.interrupt('thr_a');
    await vi.waitFor(() => expect(f.runner.listActive()).toHaveLength(0));

    const stored = f.ctx.repos.messages.list('thr_a');
    expect(stored.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(stored[1]).toMatchObject({
      id: `msg_${turnId}_assistant`,
      content: `partial answer${INTERRUPTED_MARKER}`,
    });
    expect(f.turnStatus(turnId)).toBe('interrupted');
  });

  it('rejects a concurrent send and a blank message', async () => {
    const f = setup();
    await f.runner.send('thr_a', 'first');
    await expect(f.runner.send('thr_a', 'second')).rejects.toMatchObject({ code: 'conflict' });
    f.adapter.end();

    const idle = setup();
    await expect(idle.runner.send('thr_a', '   ')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(idle.runner.send('thr_missing', 'hello')).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('reports a missing provider and a disabled provider with contract codes', async () => {
    const missing = setup();
    missing.ctx.repos.threads.create({
      id: 'thr_orphan',
      projectId: 'prj_a',
      parentThreadId: null,
      title: 'orphan',
      providerId: 'prv_missing',
      modelId: 'model-x',
      executionMode: 'work',
      permissionMode: 'ask',
      status: 'idle',
      worktreePath: missing.ctx.env.root,
      branch: null,
      baseBranch: null,
      createdAt: ISO,
      updatedAt: ISO,
    });
    await expect(missing.runner.send('thr_orphan', 'hello')).rejects.toMatchObject({
      code: 'not-found',
    });

    const disabled = setup({ providerEnabled: false });
    await expect(disabled.runner.send('thr_a', 'hello')).rejects.toMatchObject({
      code: 'provider-unavailable',
    });
  });

  it('turns an adapter throw into error events and a failed thread', async () => {
    const f = setup();
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');

    f.adapter.push({ type: 'turn.started', turnId });
    f.adapter.fail('socket closed');
    await ended;

    const rows = f.ctx.repos.events.since('thr_a', 0, 100);
    expect(rows.map((row) => row.type)).toEqual(['turn.started', 'error', 'turn.finished']);
    expect(rows[1]?.payload).toMatchObject({ message: expect.stringContaining('socket closed') });
    expect(f.threadStatus()).toBe('failed');
    expect(f.turnStatus(turnId)).toBe('failed');
  });

  it('synthesizes a failed finish when the stream ends without turn.finished', async () => {
    const f = setup();
    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'hello');
    f.adapter.push({ type: 'turn.started', turnId });
    f.adapter.end();
    await ended;

    expect(f.ctx.repos.events.since('thr_a', 0, 100).map((row) => row.type)).toEqual([
      'turn.started',
      'error',
      'turn.finished',
    ]);
    expect(f.turnStatus(turnId)).toBe('failed');
  });

  it('resolves attachments inside the worktree and rejects escaping paths', async () => {
    const f = setup();
    const { turnId } = await f.runner.send('thr_a', '', [
      { name: 'shot.png', path: 'shot.png', mimeType: 'image/png' },
      { name: 'notes.txt', path: 'notes.txt' },
    ]);
    expect(turnId).toMatch(/^turn_/);
    const ctx = f.adapter.sends[0]?.ctx;
    expect(ctx?.attachments).toEqual([
      { path: join(f.ctx.env.root, 'shot.png'), kind: 'image' },
      { path: join(f.ctx.env.root, 'notes.txt'), kind: 'file' },
    ]);
    f.adapter.end();

    const other = setup();
    await expect(
      other.runner.send('thr_a', '', [{ name: 'escape', path: '../escape.txt' }]),
    ).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('denies an approval whose run died and fails the thread', async () => {
    const f = setup();
    f.ctx.repos.approvals.create({
      id: 'apv_dead',
      threadId: 'thr_a',
      toolCallId: 'call_1',
      toolName: 'bash',
      input: {},
      createdAt: ISO,
    });

    await expect(f.runner.approve('thr_a', 'apv_dead', 'allow')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(f.ctx.repos.approvals.get('apv_dead')).toMatchObject({ decision: 'deny' });
    expect(f.threadStatus()).toBe('failed');
  });

  it('creates an approval, parks the thread, and resumes it on allow', async () => {
    const f = setup();
    const requested = waitFor(f.bus, (event) => event.type === 'approval.requested');
    const { turnId } = await f.runner.send('thr_a', 'run the tool');

    f.adapter.push({
      type: 'approval.requested',
      turnId,
      approvalId: 'apv_1',
      toolCallId: 'call_1',
      name: 'bash',
      input: { command: 'ls' },
    });
    await requested;

    const pending = f.ctx.repos.approvals.get('apv_1');
    expect(pending).toMatchObject({ decision: 'pending', toolName: 'bash' });
    expect(f.threadStatus()).toBe('needs-approval');
    expect(f.turnStatus(turnId)).toBe('needs-approval');

    await f.runner.approve('thr_a', 'apv_1', 'allow');
    expect(f.adapter.approvals).toEqual([{ approvalId: 'apv_1', decision: 'allow' }]);
    expect(f.ctx.repos.approvals.get('apv_1')).toMatchObject({ decision: 'allow' });
    expect(f.threadStatus()).toBe('running');
    expect(f.turnStatus(turnId)).toBe('running');

    const ended = waitForTurnEnd(f.bus);
    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
  });

  it('forwards deny and allow-thread unchanged and rejects unknown or resolved approvals', async () => {
    const f = setup();
    const { turnId } = await f.runner.send('thr_a', 'run the tool');

    f.adapter.push(
      {
        type: 'approval.requested',
        turnId,
        approvalId: 'apv_deny',
        toolCallId: 'call_1',
        name: 'bash',
        input: {},
      },
      {
        type: 'approval.requested',
        turnId,
        approvalId: 'apv_thread',
        toolCallId: 'call_2',
        name: 'bash',
        input: {},
      },
    );
    await waitFor(
      f.bus,
      (event) => event.type === 'approval.requested' && event.payload.id === 'apv_thread',
    );

    await expect(f.runner.approve('thr_a', 'apv_missing', 'allow')).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(f.adapter.approvals).toEqual([]);

    await f.runner.approve('thr_a', 'apv_deny', 'deny');
    await f.runner.approve('thr_a', 'apv_thread', 'allow-thread');
    expect(f.adapter.approvals).toEqual([
      { approvalId: 'apv_deny', decision: 'deny' },
      { approvalId: 'apv_thread', decision: 'allow-thread' },
    ]);

    await expect(f.runner.approve('thr_a', 'apv_deny', 'allow')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(f.adapter.approvals).toHaveLength(2);
    f.adapter.end();
  });

  it('interrupts the session, denies pending approvals, and ends ready-to-review', async () => {
    const f = setup();
    const { turnId } = await f.runner.send('thr_a', 'run the tool');
    f.adapter.push({
      type: 'approval.requested',
      turnId,
      approvalId: 'apv_1',
      toolCallId: 'call_1',
      name: 'bash',
      input: {},
    });
    await waitFor(f.bus, (event) => event.type === 'approval.requested');

    await f.runner.interrupt('thr_a');
    expect(f.adapter.interrupts).toBe(1);
    expect(f.ctx.repos.approvals.get('apv_1')?.decision).toBe('deny');
    expect(f.threadStatus()).toBe('ready-to-review');
    expect(f.turnStatus(turnId)).toBe('interrupted');
  });

  it('is a no-op interrupt for an idle thread and a conflict for a stuck one', async () => {
    const f = setup();
    await expect(f.runner.interrupt('thr_a')).resolves.toBeUndefined();
    f.ctx.repos.threads.update('thr_a', { status: 'running', updatedAt: ISO });
    await expect(f.runner.interrupt('thr_a')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('records brain injection ids on the turn and touches them once', async () => {
    const f = setup();
    const rule = f.ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'always run pnpm',
      appliesTo: 'all',
    });
    const memory = f.ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'sharedtoken memory',
    });
    const { turnId } = await f.runner.send('thr_a', 'sharedtoken please');
    const turn = f.ctx.repos.turns.get(turnId);
    expect(turn?.injectedIds).toEqual(expect.arrayContaining([rule.id, memory.id]));
    expect(f.ctx.repos.brain.get(rule.id)?.useCount).toBe(1);
    expect(f.ctx.repos.brain.get(memory.id)?.useCount).toBe(1);

    const ctx = f.adapter.sends[0]?.ctx;
    expect(ctx?.systemPrompt).toContain('always run pnpm');
    expect(ctx?.systemPrompt).toContain('sharedtoken memory');
    expect(ctx?.brainSlice).toBe('');
    f.adapter.end();
  });

  it('captures a standing rule from the message once and never duplicates it', async () => {
    const f = setup();

    const firstEnd = waitForTurnEnd(f.bus);
    const first = await f.runner.send('thr_a', 'always remember: use pnpm');
    f.adapter.push({ type: 'turn.finished', turnId: first.turnId, reason: 'complete' });
    await firstEnd;
    await vi.waitFor(() => expect(f.runner.listActive()).toHaveLength(0));

    const rules = f.ctx.repos.brain.list({ kind: 'rule' });
    expect(rules.map((entry) => entry.text)).toEqual(['use pnpm']);
    expect(rules[0]?.appliesTo).toBe('all');

    const secondEnd = waitForTurnEnd(f.bus);
    const second = await f.runner.send('thr_a', 'always remember: use pnpm');
    f.adapter.push({ type: 'turn.finished', turnId: second.turnId, reason: 'complete' });
    await secondEnd;
    await vi.waitFor(() => expect(f.runner.listActive()).toHaveLength(0));

    expect(f.ctx.repos.brain.list({ kind: 'rule' })).toHaveLength(1);
  });

  it('keeps the turn running when standing rule capture fails', async () => {
    const f = setup();
    const upsert = vi.spyOn(f.ctx.repos.brain, 'upsert');
    upsert.mockImplementation(() => {
      throw new Error('brain store offline');
    });

    const ended = waitForTurnEnd(f.bus);
    const { turnId } = await f.runner.send('thr_a', 'always remember: use pnpm');

    expect(f.turnStatus(turnId)).toBe('running');
    expect(f.ctx.repos.messages.list('thr_a')).toHaveLength(1);

    f.adapter.push({ type: 'turn.finished', turnId, reason: 'complete' });
    await ended;
    expect(f.turnStatus(turnId)).toBe('complete');
    upsert.mockRestore();
  });

  it('assembles base, custom instructions, brain, context, then the user message', async () => {
    const f = setup();
    f.ctx.repos.settings.patch({ customInstructions: 'Prefer pnpm.\r\nNever force push.' });
    const rule = f.ctx.repos.brain.upsert({
      kind: 'rule',
      scope: 'global',
      text: 'pin tool versions',
      appliesTo: 'all',
    });
    const memory = f.ctx.repos.brain.upsert({
      kind: 'memory',
      scope: 'global',
      text: 'promptparity marker',
    });
    const message = 'promptparity run the suite';
    await f.runner.send('thr_a', message);

    const ctx = f.adapter.sends[0]?.ctx;
    const system = ctx?.systemPrompt ?? '';
    const thread = f.ctx.repos.threads.get('thr_a');
    const project = f.ctx.repos.projects.get('prj_a');
    if (thread === undefined || project === undefined) throw new Error('fixture is incomplete');

    const plan = planPrompt(f.ctx.repos, {
      thread,
      project,
      message,
      settings: f.ctx.repos.settings.get(),
    });
    expect(system).toBe(plan.assembly.systemPrompt);
    expect(ctx?.brainSlice).toBe('');
    expect(system.startsWith(BASE_SYSTEM_PROMPT)).toBe(true);

    const custom = system.indexOf('## Custom instructions');
    const brain = system.indexOf('pin tool versions');
    const retrieved = system.indexOf('promptparity marker');
    const context = system.indexOf('<context>');
    expect(custom).toBeGreaterThan(0);
    expect(custom).toBeLessThan(brain);
    expect(brain).toBeLessThan(retrieved);
    expect(retrieved).toBeLessThan(context);
    expect(system).toContain('Prefer pnpm.\nNever force push.');
    expect(system).not.toContain(message);

    expect(f.ctx.repos.brain.get(rule.id)?.useCount).toBe(1);
    expect(f.ctx.repos.brain.get(memory.id)?.useCount).toBe(1);
    f.adapter.end();
  });

  it('reuses a session for the same provider and model and replaces it after a change', async () => {
    const f = setup();
    const firstEnded = waitForTurnEnd(f.bus);
    const first = await f.runner.send('thr_a', 'one');
    f.adapter.push({ type: 'turn.finished', turnId: first.turnId, reason: 'complete' });
    await firstEnded;
    await vi.waitFor(() => expect(f.runner.listActive()).toHaveLength(0));

    const secondEnded = waitForTurnEnd(f.bus);
    const second = await f.runner.send('thr_a', 'two');
    expect(f.adapterCalls).toHaveLength(1);
    f.adapter.push({ type: 'turn.finished', turnId: second.turnId, reason: 'complete' });
    await secondEnded;
    await vi.waitFor(() => expect(f.runner.listActive()).toHaveLength(0));

    f.ctx.repos.threads.update('thr_a', { modelId: 'model-y', updatedAt: ISO });
    const thirdEnded = waitForTurnEnd(f.bus);
    const third = await f.runner.send('thr_a', 'three');
    expect(f.adapterCalls).toHaveLength(2);
    expect(f.adapter.disposes).toBe(1);
    f.adapter.push({ type: 'turn.finished', turnId: third.turnId, reason: 'complete' });
    await thirdEnded;
    await vi.waitFor(() => expect(f.runner.listActive()).toHaveLength(0));

    await f.runner.disposeThread('thr_a');
    expect(f.adapter.disposes).toBe(2);
    await f.runner.disposeAll();
    expect(f.adapter.disposes).toBe(2);
  });

  it('resolves a provider secret ref through the bridge before creating the adapter', async () => {
    const f = setup();
    const seen: (string | null)[] = [];
    const withSecret = createRunner({
      repos: f.ctx.repos,
      bus: f.bus,
      logger: silentLogger(),
      secrets: {
        available: true,
        get: async (key) => (key === 'provider:prv_test' ? 'sk-resolved' : null),
        set: async () => undefined,
        dispose: () => undefined,
      },
      settings: () => f.ctx.repos.settings.get(),
      createAdapter: async (_provider, secret) => {
        seen.push(secret);
        return f.adapter;
      },
    });
    f.ctx.repos.providers.upsert({
      id: 'prv_test',
      kind: 'claude',
      label: 'Test',
      config: {},
      secretRef: 'provider:prv_test',
    });
    await withSecret.send('thr_a', 'hello');
    expect(seen).toEqual(['sk-resolved']);
    f.adapter.end();
    await withSecret.disposeAll();
  });
});
