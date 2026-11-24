import type { ServerEvent } from '@tuffcode/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus, type EventBus } from '../events.js';
import { createTestContext, type TestContext } from '../test-support.js';
import {
  createProviderLogins,
  type KillLoginTree,
  type LoginPty,
  type ProviderLogins,
  type SpawnLoginPty,
} from './login.js';

class FakePty implements LoginPty {
  readonly pid = 4242;
  killed = false;
  readonly dataListeners: ((data: string) => void)[] = [];
  readonly exitListeners: ((exitCode: number) => void)[] = [];

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (exitCode: number) => void): void {
    this.exitListeners.push(listener);
  }

  kill(): void {
    this.killed = true;
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  exit(exitCode: number): void {
    for (const listener of this.exitListeners) listener(exitCode);
  }
}

interface Spawned {
  file: string;
  args: string[];
  env: Record<string, string>;
  pty: FakePty;
}

describe('provider login', () => {
  let ctx: TestContext;
  let bus: EventBus;
  let events: ServerEvent[];
  let spawned: Spawned[];
  let killed: number[];
  let logins: ProviderLogins;
  let previousToken: string | undefined;

  beforeEach(() => {
    ctx = createTestContext();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
    spawned = [];
    killed = [];
    const spawnPty: SpawnLoginPty = (file, args, env) => {
      const pty = new FakePty();
      spawned.push({ file, args, env, pty });
      return pty;
    };
    const killTree: KillLoginTree = async (pid) => {
      killed.push(pid);
    };
    logins = createProviderLogins({
      repos: ctx.repos,
      bus,
      resolveCommand: async (name) => (name === 'claude' ? 'C:/tools/claude.exe' : null),
      spawnPty,
      killTree,
    });
    previousToken = process.env.TUFFCODE_TOKEN;
    process.env.TUFFCODE_TOKEN = 'server-token-must-not-leak';
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.TUFFCODE_TOKEN;
    else process.env.TUFFCODE_TOKEN = previousToken;
    ctx.dispose();
  });

  it('streams CLI output and reports a successful exit', async () => {
    ctx.repos.providers.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });

    const { loginId } = await logins.start('prv_claude');
    expect(loginId).toMatch(/^login_[0-9a-f]{16}$/);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.file).toBe('C:/tools/claude.exe');
    expect(spawned[0]?.args).toEqual(['auth', 'login']);
    expect(spawned[0]?.env['TUFFCODE_TOKEN']).toBeUndefined();
    expect(spawned[0]?.env['TERM']).toBe('xterm-256color');

    spawned[0]?.pty.emitData('Visit https://claude.ai/oauth to sign in');
    expect(events).toEqual([
      {
        kind: 'event',
        type: 'provider.login.output',
        payload: {
          loginId,
          providerId: 'prv_claude',
          chunk: 'Visit https://claude.ai/oauth to sign in',
        },
      },
    ]);

    spawned[0]?.pty.exit(0);
    expect(events.at(-1)).toEqual({
      kind: 'event',
      type: 'provider.login.done',
      payload: { loginId, providerId: 'prv_claude', ok: true, detail: 'signed in' },
    });
    expect(killed).toEqual([]);
  });

  it('reports a failing exit without inventing success', async () => {
    ctx.repos.providers.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });
    const { loginId } = await logins.start('prv_claude');

    spawned[0]?.pty.exit(2);
    expect(events.at(-1)).toEqual({
      kind: 'event',
      type: 'provider.login.done',
      payload: { loginId, providerId: 'prv_claude', ok: false, detail: 'login exited with code 2' },
    });
  });

  it('cancels by killing the process tree and reports a cancelled exit', async () => {
    ctx.repos.providers.upsert({ id: 'prv_claude', kind: 'claude', label: 'Claude', config: {} });
    const { loginId } = await logins.start('prv_claude');

    await logins.cancel(loginId);
    expect(killed).toEqual([4242]);
    expect(spawned[0]?.pty.killed).toBe(true);

    spawned[0]?.pty.exit(1);
    expect(events.at(-1)).toEqual({
      kind: 'event',
      type: 'provider.login.done',
      payload: { loginId, providerId: 'prv_claude', ok: false, detail: 'cancelled' },
    });

    await expect(logins.cancel(loginId)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('runs the codex login flow and honours a configured command', async () => {
    ctx.repos.providers.upsert({
      id: 'prv_codex',
      kind: 'codex',
      label: 'Codex',
      config: { command: ['codex-work', '--profile', 'work'] },
    });
    const resolving = createProviderLogins({
      repos: ctx.repos,
      bus,
      resolveCommand: async (name) => (name === 'codex-work' ? 'C:/tools/codex.exe' : null),
      spawnPty: (file, args, env) => {
        const pty = new FakePty();
        spawned.push({ file, args, env, pty });
        return pty;
      },
      killTree: async () => undefined,
    });

    await resolving.start('prv_codex');
    expect(spawned[0]?.file).toBe('C:/tools/codex.exe');
    expect(spawned[0]?.args).toEqual(['login']);
  });

  it('rejects kinds without a login flow and unknown providers', async () => {
    ctx.repos.providers.upsert({ id: 'prv_acp', kind: 'acp', label: 'ACP', config: {} });
    ctx.repos.providers.upsert({
      id: 'prv_api',
      kind: 'openai-compatible',
      label: 'API',
      config: { baseUrl: 'https://api.example.com' },
    });

    await expect(logins.start('prv_acp')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(logins.start('prv_api')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(logins.start('prv_missing')).rejects.toMatchObject({ code: 'not-found' });
    expect(spawned).toEqual([]);
  });

  it('rejects a subscription provider whose CLI is missing', async () => {
    ctx.repos.providers.upsert({ id: 'prv_codex', kind: 'codex', label: 'Codex', config: {} });
    await expect(logins.start('prv_codex')).rejects.toMatchObject({
      code: 'bad-request',
      message: expect.stringContaining('npm install -g @openai/codex'),
    });
    expect(spawned).toEqual([]);
  });
});
