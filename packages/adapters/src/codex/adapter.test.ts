import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  AdapterUnavailableError,
  type AdapterDeps,
  type AdapterEvent,
  type AdapterLogger,
  type AdapterSession,
  type ProviderConfig,
  type TurnContext,
} from '@tuffcode/contracts';
import { createCodexAdapter, type CodexChild, type CodexSpawn } from './adapter.js';

const provider: ProviderConfig = {
  id: 'prov_codex',
  kind: 'codex',
  label: 'Codex',
  config: {},
  secret: null,
};

const noopLogger: AdapterLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function makeDeps(resolved: string | null = 'C:/fake/codex.exe'): AdapterDeps {
  return {
    logger: noopLogger,
    resolveCommand: async () => resolved,
    env: {},
  };
}

function makeContext(turnId = 'turn-1'): TurnContext {
  return {
    turnId,
    cwd: 'C:/work/demo',
    systemPrompt: 'You are Tuffcode.',
    permissionMode: 'ask',
    model: 'gpt-5-codex',
    brainSlice: 'rules: be brief',
    attachments: [{ path: 'C:/work/demo/notes.md', kind: 'file' }],
    vision: false,
    signal: new AbortController().signal,
  };
}

interface FakeChild {
  child: CodexChild;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  writes: Record<string, unknown>[];
  kill: ReturnType<typeof vi.fn>;
  exit(code?: number): void;
  fail(error: Error): void;
}

function createFakeChild(): FakeChild {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: Record<string, unknown>[] = [];

  let buffer = '';
  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      writes.push(JSON.parse(line) as Record<string, unknown>);
      index = buffer.indexOf('\n');
    }
  });

  let exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  let errorListener: ((error: Error) => void) | null = null;
  const kill = vi.fn(() => true);

  const child: CodexChild = {
    pid: 4242,
    stdin,
    stdout,
    stderr,
    kill,
    onExit(listener) {
      exitListener = listener;
    },
    onError(listener) {
      errorListener = listener;
    },
  };

  return {
    child,
    stdin,
    stdout,
    stderr,
    writes,
    kill,
    exit(code = 0) {
      exitListener?.(code, null);
    },
    fail(error) {
      errorListener?.(error);
    },
  };
}

function frame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor<T>(probe: () => T | undefined, label = 'condition'): Promise<T> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const value = probe();
    if (value !== undefined) return value;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function openSession(): Promise<{ fake: FakeChild; session: AdapterSession }> {
  const fake = createFakeChild();
  const sessionPromise = createCodexAdapter(provider, makeDeps(), {
    spawn: () => fake.child,
    skipLoginCheck: true,
  });

  const init = await waitFor(() => fake.writes.find((entry) => entry.method === 'initialize'));
  fake.stdout.write(
    frame({
      id: init.id,
      result: {
        userAgent: 'codex/0.0.0',
        codexHome: 'C:/codex',
        platformFamily: 'windows',
        platformOs: 'windows',
      },
    }),
  );

  const session = await sessionPromise;
  return { fake, session };
}

/**
 * Async generators only advance when pulled, so the driver keeps one
 * outstanding `next()` while the test answers requests and emits frames.
 */
class TurnDriver {
  private pending: Promise<IteratorResult<AdapterEvent>>;

  constructor(private readonly iterator: AsyncIterator<AdapterEvent>) {
    this.pending = iterator.next();
  }

  async next(): Promise<AdapterEvent> {
    const result = await this.pending;
    this.pending = this.iterator.next();
    if (result.done === true) throw new Error('generator finished before turn.finished');
    return result.value;
  }

  async drain(): Promise<AdapterEvent[]> {
    const events: AdapterEvent[] = [];
    while (true) {
      const event = await this.next();
      events.push(event);
      if (event.type === 'turn.finished') return events;
    }
  }

  async isDone(): Promise<boolean> {
    return (await this.pending).done === true;
  }
}

function turnStartFrames(fake: FakeChild, count: number): Record<string, unknown> | undefined {
  const frames = fake.writes.filter((entry) => entry.method === 'turn/start');
  return frames.length >= count ? frames[count - 1] : undefined;
}

describe('createCodexAdapter', () => {
  it('spawns app-server and performs the initialize handshake', async () => {
    const { fake, session } = await openSession();

    expect(fake.writes[0]).toEqual({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'tuffcode', title: 'Tuffcode', version: '0.0.0' },
        capabilities: null,
      },
    });
    expect(fake.writes[1]).toEqual({ method: 'initialized' });
    expect(session.id).toMatch(/^sess_/);
    expect(session.providerId).toBe('prov_codex');
    expect(session.capabilities).toEqual({ tools: true, approvals: true, resume: true, models: true });

    await session.dispose();
  });

  it('throws AdapterUnavailableError when the CLI cannot be resolved', async () => {
    const spawn = vi.fn();
    const error = await createCodexAdapter(provider, makeDeps(null), { spawn }).catch((reason) => reason);

    expect(error).toBeInstanceOf(AdapterUnavailableError);
    expect((error as AdapterUnavailableError).providerId).toBe('prov_codex');
    expect((error as AdapterUnavailableError).hint).toContain('Codex CLI not found');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('throws AdapterUnavailableError when codex login status reports signed out', async () => {
    const loginFake = createFakeChild();
    const appFake = createFakeChild();
    const spawn = vi.fn<CodexSpawn>((_command, args) => (args[0] === 'login' ? loginFake.child : appFake.child));

    const sessionPromise = createCodexAdapter(provider, makeDeps(), { spawn });
    await waitFor(() => (spawn.mock.calls.length > 0 ? spawn.mock.calls[0] : undefined));
    expect(spawn.mock.calls[0]?.[1]).toEqual(['login', 'status']);

    loginFake.stderr.write('Not logged in\n');
    await flush();
    loginFake.exit(1);

    const error = await sessionPromise.catch((reason) => reason);
    expect(error).toBeInstanceOf(AdapterUnavailableError);
    expect((error as AdapterUnavailableError).hint).toContain('codex login');
    expect(appFake.writes).toHaveLength(0);
  });

  it('surfaces a handshake failure as provider-unavailable and kills the child', async () => {
    const fake = createFakeChild();
    const sessionPromise = createCodexAdapter(provider, makeDeps(), {
      spawn: () => fake.child,
      skipLoginCheck: true,
    });

    const init = await waitFor(() => fake.writes.find((entry) => entry.method === 'initialize'));
    fake.stdout.write(frame({ id: init.id, error: { code: -32600, message: 'unknown method' } }));

    const error = await sessionPromise.catch((reason) => reason);
    expect(error).toBeInstanceOf(AdapterUnavailableError);
    expect((error as AdapterUnavailableError).hint).toContain('handshake failed');
    expect(fake.kill).toHaveBeenCalledTimes(1);
  });
});

describe('send', () => {
  it('creates the thread once and streams a full turn', async () => {
    const { fake, session } = await openSession();
    const turn = new TurnDriver(session.send('hi', makeContext())[Symbol.asyncIterator]());

    expect(await turn.next()).toMatchObject({
      type: 'session.started',
      sessionId: session.id,
      model: 'gpt-5-codex',
      capabilities: { tools: true, approvals: true, resume: true },
    });
    expect(await turn.next()).toEqual({ type: 'turn.started', turnId: 'turn-1' });

    const threadFrame = await waitFor(() => fake.writes.find((entry) => entry.method === 'thread/start'));
    expect(threadFrame.params).toMatchObject({
      cwd: 'C:/work/demo',
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      baseInstructions: 'You are Tuffcode.',
      developerInstructions: 'rules: be brief',
      model: 'gpt-5-codex',
    });
    fake.stdout.write(frame({ id: threadFrame.id, result: { thread: { id: 'th_1' } } }));

    const turnFrame = await waitFor(() => turnStartFrames(fake, 1));
    expect(turnFrame.params).toMatchObject({
      threadId: 'th_1',
      cwd: 'C:/work/demo',
      model: 'gpt-5-codex',
      approvalPolicy: 'on-request',
    });
    expect((turnFrame.params as Record<string, unknown>).input).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'mention', name: 'notes.md', path: 'C:/work/demo/notes.md' },
    ]);
    fake.stdout.write(frame({ id: turnFrame.id, result: { turn: { id: 'codex-turn-1' } } }));

    fake.stdout.write(
      frame({
        method: 'item/started',
        params: {
          threadId: 'th_1',
          turnId: 'codex-turn-1',
          item: { type: 'commandExecution', id: 'call_1', command: 'npm test', cwd: 'C:/work/demo' },
        },
      }) +
        frame({
          method: 'item/commandExecution/outputDelta',
          params: { threadId: 'th_1', turnId: 'codex-turn-1', itemId: 'call_1', delta: 'ok\n' },
        }) +
        frame({
          method: 'item/completed',
          params: {
            threadId: 'th_1',
            turnId: 'codex-turn-1',
            item: {
              type: 'commandExecution',
              id: 'call_1',
              status: 'completed',
              aggregatedOutput: 'ok\n',
              exitCode: 0,
            },
          },
        }) +
        frame({
          method: 'item/agentMessage/delta',
          params: { threadId: 'th_1', turnId: 'codex-turn-1', itemId: 'msg_1', delta: 'done' },
        }) +
        frame({
          method: 'turn/completed',
          params: { threadId: 'th_1', turn: { id: 'codex-turn-1', status: 'completed', error: null } },
        }),
    );

    const events = await turn.drain();
    expect(events.map((event) => event.type)).toEqual([
      'tool.started',
      'tool.delta',
      'tool.finished',
      'text.delta',
      'turn.finished',
    ]);
    expect(events[0]).toMatchObject({ name: 'command', toolCallId: 'call_1' });
    expect(events[3]).toEqual({ type: 'text.delta', turnId: 'turn-1', text: 'done' });
    expect(events[4]).toEqual({ type: 'turn.finished', turnId: 'turn-1', reason: 'complete' });

    const second = new TurnDriver(session.send('again', makeContext('turn-2'))[Symbol.asyncIterator]());
    expect(await second.next()).toEqual({ type: 'turn.started', turnId: 'turn-2' });
    expect(fake.writes.filter((entry) => entry.method === 'thread/start')).toHaveLength(1);

    const secondTurn = await waitFor(() => turnStartFrames(fake, 2));
    fake.stdout.write(frame({ id: secondTurn.id, result: { turn: { id: 'codex-turn-2' } } }));
    fake.stdout.write(
      frame({
        method: 'turn/completed',
        params: { threadId: 'th_1', turn: { id: 'codex-turn-2', status: 'completed', error: null } },
      }),
    );

    expect(await second.drain()).toEqual([
      { type: 'turn.finished', turnId: 'turn-2', reason: 'complete' },
    ]);

    await session.dispose();
  });

  it('round-trips an approval request through approve()', async () => {
    const { fake, session } = await openSession();
    const turn = new TurnDriver(session.send('run it', makeContext())[Symbol.asyncIterator]());

    await turn.next();
    await turn.next();

    const threadFrame = await waitFor(() => fake.writes.find((entry) => entry.method === 'thread/start'));
    fake.stdout.write(frame({ id: threadFrame.id, result: { thread: { id: 'th_1' } } }));

    const turnFrame = await waitFor(() => turnStartFrames(fake, 1));
    fake.stdout.write(frame({ id: turnFrame.id, result: { turn: { id: 'codex-turn-1' } } }));

    fake.stdout.write(
      frame({
        id: 900,
        method: 'item/commandExecution/requestApproval',
        params: {
          kind: 'command',
          threadId: 'th_1',
          turnId: 'codex-turn-1',
          itemId: 'call_9',
          approvalId: 'ap_9',
          command: 'rm -rf build',
          cwd: 'C:/work/demo',
        },
      }),
    );

    const approval = await turn.next();
    expect(approval).toMatchObject({
      type: 'approval.requested',
      turnId: 'turn-1',
      approvalId: 'ap_9',
      toolCallId: 'call_9',
      name: 'command',
    });

    session.approve('missing', 'allow');
    expect(fake.writes.some((entry) => entry.id === 900)).toBe(false);

    session.approve('ap_9', 'allow');
    const response = await waitFor(() => fake.writes.find((entry) => entry.id === 900));
    expect(response).toEqual({ id: 900, result: { decision: 'accept' } });

    fake.stdout.write(
      frame({
        method: 'turn/completed',
        params: { threadId: 'th_1', turn: { id: 'codex-turn-1', status: 'completed', error: null } },
      }),
    );

    expect(await turn.drain()).toEqual([
      { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' },
    ]);

    await session.dispose();
  });

  it('interrupts the vendor turn and ends the stream', async () => {
    const { fake, session } = await openSession();
    const turn = new TurnDriver(session.send('long job', makeContext())[Symbol.asyncIterator]());

    await turn.next();
    await turn.next();

    const threadFrame = await waitFor(() => fake.writes.find((entry) => entry.method === 'thread/start'));
    fake.stdout.write(frame({ id: threadFrame.id, result: { thread: { id: 'th_1' } } }));

    const turnFrame = await waitFor(() => turnStartFrames(fake, 1));
    fake.stdout.write(frame({ id: turnFrame.id, result: { turn: { id: 'codex-turn-1' } } }));

    await session.interrupt();

    const interruptFrame = await waitFor(() => fake.writes.find((entry) => entry.method === 'turn/interrupt'));
    expect(interruptFrame.params).toEqual({ threadId: 'th_1', turnId: 'codex-turn-1' });
    expect(await turn.next()).toEqual({
      type: 'turn.finished',
      turnId: 'turn-1',
      reason: 'interrupted',
    });
    expect(await turn.isDone()).toBe(true);

    await session.dispose();
  });

  it('does not start a vendor turn when interrupted during thread creation', async () => {
    const { fake, session } = await openSession();
    const turn = new TurnDriver(session.send('long job', makeContext())[Symbol.asyncIterator]());

    await turn.next();
    await turn.next();

    const threadFrame = await waitFor(() => fake.writes.find((entry) => entry.method === 'thread/start'));
    await session.interrupt();
    fake.stdout.write(frame({ id: threadFrame.id, result: { thread: { id: 'th_1' } } }));

    expect(await turn.next()).toEqual({
      type: 'turn.finished',
      turnId: 'turn-1',
      reason: 'interrupted',
    });
    expect(fake.writes.some((entry) => entry.method === 'turn/start')).toBe(false);
    expect(fake.writes.some((entry) => entry.method === 'turn/interrupt')).toBe(false);

    await session.dispose();
  });

  it('ends the turn with an error when the child exits', async () => {
    const { fake, session } = await openSession();
    const turn = new TurnDriver(session.send('hi', makeContext())[Symbol.asyncIterator]());

    await turn.next();
    await turn.next();

    const threadFrame = await waitFor(() => fake.writes.find((entry) => entry.method === 'thread/start'));
    fake.stdout.write(frame({ id: threadFrame.id, result: { thread: { id: 'th_1' } } }));

    const turnFrame = await waitFor(() => turnStartFrames(fake, 1));
    fake.stdout.write(frame({ id: turnFrame.id, result: { turn: { id: 'codex-turn-1' } } }));

    fake.exit(1);

    const events = await turn.drain();
    expect(events[0]).toMatchObject({ type: 'error', retryable: false });
    expect(events[1]).toEqual({ type: 'turn.finished', turnId: 'turn-1', reason: 'error' });

    await session.dispose();
  });
});

describe('dispose', () => {
  it('kills the child once and refuses further turns', async () => {
    const { fake, session } = await openSession();

    await session.dispose();
    expect(fake.kill).toHaveBeenCalledTimes(1);

    await session.dispose();
    expect(fake.kill).toHaveBeenCalledTimes(1);

    const next = session.send('x', makeContext())[Symbol.asyncIterator]().next();
    await expect(next).rejects.toThrow('codex adapter disposed');
  });
});
