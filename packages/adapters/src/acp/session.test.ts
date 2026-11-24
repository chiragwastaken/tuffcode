import { describe, expect, it } from 'vitest';
import {
  agent,
  methods,
  PROTOCOL_VERSION,
  type ContentBlock,
  type NewSessionRequest,
  type PermissionOption,
  type RequestPermissionResponse,
  type SessionUpdate,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type { AdapterEvent, AdapterLogger, TurnContext } from '@tuffcode/contracts';
import { openAcpSession } from './session.js';

interface FakeScript {
  readonly updates?: readonly SessionUpdate[];
  readonly foreignUpdate?: SessionUpdate;
  readonly permission?: {
    readonly toolCall: ToolCallUpdate;
    readonly options: PermissionOption[];
  };
  readonly hold?: boolean;
  readonly failPrompt?: boolean;
  readonly advertiseSystemPrompt?: boolean;
}

interface Observed {
  newSession: NewSessionRequest | null;
  promptBlocks: ContentBlock[] | null;
  permissionOutcome: RequestPermissionResponse['outcome'] | null;
  cancelled: boolean;
  readonly promptStarted: Promise<void>;
  readonly markPromptStarted: () => void;
  release: () => void;
}

function createObserved(): Observed {
  let resolveStarted!: () => void;
  const promptStarted = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  return {
    newSession: null,
    promptBlocks: null,
    permissionOutcome: null,
    cancelled: false,
    promptStarted,
    markPromptStarted: () => {
      resolveStarted();
    },
    release: () => {},
  };
}

function createFakeAgent(script: FakeScript, observed: Observed) {
  let release: (() => void) | null = null;
  observed.release = () => {
    release?.();
  };

  return agent({ name: 'fake-acp' })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        ...(script.advertiseSystemPrompt ? { sessionCapabilities: { systemPrompt: {} } } : {}),
      },
      agentInfo: { name: 'fake-acp', version: '0.0.0' },
    }))
    .onRequest(methods.agent.session.new, ({ params }) => {
      observed.newSession = params;
      return { sessionId: 'sess-1' };
    })
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      observed.markPromptStarted();
      observed.promptBlocks = ctx.params.prompt;
      if (script.foreignUpdate) {
        await ctx.client.notify(methods.client.session.update, {
          sessionId: 'other-session',
          update: script.foreignUpdate,
        });
      }
      for (const update of script.updates ?? []) {
        await ctx.client.notify(methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update,
        });
      }
      if (script.permission) {
        const response = await ctx.client.request(methods.client.session.requestPermission, {
          sessionId: ctx.params.sessionId,
          toolCall: script.permission.toolCall,
          options: script.permission.options,
        });
        observed.permissionOutcome = response.outcome;
      }
      if (script.failPrompt) {
        throw new Error('agent exploded');
      }
      if (script.hold) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { stopReason: observed.cancelled ? ('cancelled' as const) : ('end_turn' as const) };
    })
    .onNotification(methods.agent.session.cancel, () => {
      observed.cancelled = true;
      release?.();
    });
}

function createLogger(): AdapterLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function turnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    turnId: 'turn-1',
    cwd: 'C:/work/project',
    systemPrompt: '',
    permissionMode: 'ask',
    model: 'test-model',
    brainSlice: '',
    attachments: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function openFakeSession(script: FakeScript) {
  const observed = createObserved();
  const fake = createFakeAgent(script, observed);
  let terminateCalls = 0;
  const session = await openAcpSession({
    providerId: 'prov-acp',
    logger: createLogger(),
    connect: (app) => app.connect(fake),
    terminate: async () => {
      terminateCalls += 1;
    },
    handshakeTimeoutMs: 2000,
  });
  return { session, observed, terminateCalls: () => terminateCalls };
}

async function collect(iterable: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('ACP adapter session over an in-process fake agent', () => {
  it('creates a session with the turn cwd and streams mapped events', async () => {
    const { session, observed } = await openFakeSession({
      updates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Read file',
          name: 'read',
          kind: 'read',
          status: 'completed',
          rawInput: { path: 'a.txt' },
        },
      ],
    });

    const events = await collect(session.send('hello', turnContext()));

    expect(observed.newSession).toMatchObject({ cwd: 'C:/work/project', mcpServers: [] });
    expect(observed.promptBlocks).toEqual([{ type: 'text', text: 'hello' }]);
    expect(events).toEqual([
      {
        type: 'session.started',
        sessionId: 'sess-1',
        model: 'test-model',
        capabilities: { tools: true, approvals: true, resume: false },
      },
      { type: 'turn.started', turnId: 'turn-1' },
      { type: 'text.delta', turnId: 'turn-1', text: 'hi' },
      {
        type: 'tool.started',
        turnId: 'turn-1',
        toolCallId: 'call-1',
        name: 'read',
        input: { path: 'a.txt' },
      },
      {
        type: 'tool.finished',
        turnId: 'turn-1',
        toolCallId: 'call-1',
        output: '',
        isError: false,
      },
      { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' },
    ]);
    expect(session.id).toBe('sess-1');
  });

  it('sends the system prompt only when the agent advertises support', async () => {
    const supported = await openFakeSession({ advertiseSystemPrompt: true });
    await collect(
      supported.session.send('hello', turnContext({ systemPrompt: 'You are Tuffcode.' })),
    );
    expect(supported.observed.newSession?.systemPrompt).toEqual({
      mode: 'append',
      content: [{ type: 'text', text: 'You are Tuffcode.' }],
    });

    const unsupported = await openFakeSession({});
    await collect(
      unsupported.session.send('hello', turnContext({ systemPrompt: 'You are Tuffcode.' })),
    );
    expect(unsupported.observed.newSession?.systemPrompt).toBeUndefined();
  });

  it('drops updates that belong to another session', async () => {
    const { session } = await openFakeSession({
      foreignUpdate: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'leak' },
      },
      updates: [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'kept' } }],
    });

    const events = await collect(session.send('hello', turnContext()));
    const texts = events.filter((event) => event.type === 'text.delta');
    expect(texts).toEqual([{ type: 'text.delta', turnId: 'turn-1', text: 'kept' }]);
  });

  it('raises approval.requested and resolves it through approve()', async () => {
    const { session, observed } = await openFakeSession({
      permission: {
        toolCall: {
          toolCallId: 'call-3',
          title: 'Write config',
          name: 'write',
          kind: 'edit',
          rawInput: { path: 'config.json' },
        },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });

    const events: AdapterEvent[] = [];
    for await (const event of session.send('hello', turnContext())) {
      events.push(event);
      if (event.type === 'approval.requested') {
        expect(event.name).toBe('write');
        expect(event.toolCallId).toBe('call-3');
        expect(event.input).toEqual({ path: 'config.json' });
        session.approve(event.approvalId, 'allow');
      }
    }

    expect(events.map((event) => event.type)).toContain('approval.requested');
    expect(observed.permissionOutcome).toEqual({
      outcome: 'selected',
      optionId: 'allow-once',
    });
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn-1',
      reason: 'complete',
    });
  });

  it('auto-allows in full-auto mode without asking', async () => {
    const { session, observed } = await openFakeSession({
      permission: {
        toolCall: { toolCallId: 'call-4', title: 'Run tests', kind: 'execute' },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });

    const events = await collect(
      session.send('hello', turnContext({ permissionMode: 'full-auto' })),
    );

    expect(events.map((event) => event.type)).not.toContain('approval.requested');
    expect(observed.permissionOutcome).toEqual({
      outcome: 'selected',
      optionId: 'allow-once',
    });
  });

  it('denies edits in read-only mode without asking', async () => {
    const { session, observed } = await openFakeSession({
      permission: {
        toolCall: { toolCallId: 'call-5', title: 'Write file', kind: 'edit' },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });

    const events = await collect(
      session.send('hello', turnContext({ permissionMode: 'read-only' })),
    );

    expect(events.map((event) => event.type)).not.toContain('approval.requested');
    expect(observed.permissionOutcome).toEqual({
      outcome: 'selected',
      optionId: 'reject-once',
    });
  });

  it('ignores approve() calls for unknown ids', async () => {
    const { session } = await openFakeSession({});
    expect(() => session.approve('missing', 'allow')).not.toThrow();
  });

  it('cancels the turn through session/cancel on interrupt()', async () => {
    const { session, observed } = await openFakeSession({ hold: true });
    const iterator = session.send('hello', turnContext())[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    expect((await iterator.next()).value).toMatchObject({ type: 'turn.started' });
    const pending = iterator.next();
    await observed.promptStarted;
    await session.interrupt();

    const finished = await pending;
    expect(finished.value).toEqual({
      type: 'turn.finished',
      turnId: 'turn-1',
      reason: 'interrupted',
    });
    expect(observed.cancelled).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  it('refuses a second turn while one is running', async () => {
    const { session, observed } = await openFakeSession({ hold: true });
    const iterator = session.send('hello', turnContext())[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    const pending = iterator.next();
    await observed.promptStarted;

    const second = session.send('again', turnContext({ turnId: 'turn-2' }))[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toThrow('a turn is already running');

    await session.interrupt();
    await pending;
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
    }
  });

  it('surfaces prompt failures as an error event and a failed turn', async () => {
    const { session } = await openFakeSession({ failPrompt: true });
    const events = await collect(session.send('hello', turnContext()));

    const errors = events.filter((event) => event.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ type: 'error', retryable: false });
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn-1',
      reason: 'error',
    });
  });

  it('honors an already aborted turn signal', async () => {
    const { session } = await openFakeSession({});
    const controller = new AbortController();
    controller.abort();

    const events = await collect(session.send('hello', turnContext({ signal: controller.signal })));
    expect(events.at(-1)).toEqual({
      type: 'turn.finished',
      turnId: 'turn-1',
      reason: 'interrupted',
    });
  });

  it('terminates once on dispose and rejects further turns', async () => {
    const { session, terminateCalls } = await openFakeSession({});
    await session.dispose();
    await session.dispose();
    expect(terminateCalls()).toBe(1);

    const iterator = session.send('hello', turnContext())[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow('disposed');
  });

  it('terminates the agent when the handshake fails', async () => {
    const broken = agent({ name: 'broken-acp' });
    let terminateCalls = 0;
    await expect(
      openAcpSession({
        providerId: 'prov-acp',
        logger: createLogger(),
        connect: (app) => app.connect(broken),
        terminate: async () => {
          terminateCalls += 1;
        },
        handshakeTimeoutMs: 1000,
      }),
    ).rejects.toThrow();
    expect(terminateCalls).toBe(1);
  });
});
