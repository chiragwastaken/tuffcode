import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';
import {
  AdapterUnavailableError,
  ProviderConfigSchema,
  type AdapterCapabilities,
  type AdapterDeps,
  type AdapterLogger,
  type AdapterSession,
  type ModelInfo,
  type ProviderConfig,
  type TurnContext,
} from './index.js';

const turnContext: TurnContext = {
  turnId: 'turn-1',
  cwd: 'C:/work/tuffcode-wt/adapters',
  systemPrompt: 'You are Tuffcode.',
  permissionMode: 'ask',
  model: 'claude-opus-4-5',
  brainSlice: 'rules: never use emdash',
  attachments: [{ path: 'C:/work/a.txt', kind: 'file' }],
  vision: false,
  signal: new AbortController().signal,
};

const capabilities: AdapterCapabilities = {
  tools: true,
  approvals: true,
  resume: false,
  models: true,
};

const session: AdapterSession = {
  id: 'session-1',
  providerId: 'prov-claude',
  capabilities,
  async *send(text, ctx) {
    expect(ctx.turnId).toBe('turn-1');
    yield { type: 'text.delta', turnId: ctx.turnId, text };
  },
  approve() {},
  async interrupt() {},
  async dispose() {},
};

describe('adapter session contract', () => {
  it('accepts a fake session as an AdapterSession', async () => {
    const chunks: string[] = [];
    for await (const event of session.send('hello', turnContext)) {
      if (event.type === 'text.delta') {
        chunks.push(event.text);
      }
    }

    expect(chunks).toEqual(['hello']);
    expect(session.id).toBe('session-1');
    expect(session.providerId).toBe('prov-claude');
    expect(session.capabilities).toEqual(capabilities);
    await session.interrupt();
    await session.dispose();
    session.approve('ap1', 'allow');
  });

  it('requires every capability flag and a resolvable approval choice', () => {
    // @ts-expect-error capabilities must declare models as well
    const incomplete: AdapterCapabilities = { tools: true, approvals: true, resume: true };
    expect(incomplete.tools).toBe(true);

    // @ts-expect-error pending is a stored approval state, not a resolvable choice
    session.approve('ap1', 'pending');
  });

  it('types the dependency bag adapters receive', async () => {
    const logged: string[] = [];
    const logger: AdapterLogger = {
      debug(msg) {
        logged.push(msg);
      },
      info(msg) {
        logged.push(msg);
      },
      warn(msg) {
        logged.push(msg);
      },
      error(msg) {
        logged.push(msg);
      },
    };
    const deps: AdapterDeps = {
      logger,
      resolveCommand: async (name) => (name === 'claude' ? 'C:/bin/claude.exe' : null),
      env: { PATH: 'C:/bin' },
    };

    deps.logger.info('resolved command', { name: 'claude' });
    expect(logged).toEqual(['resolved command']);
    await expect(deps.resolveCommand('claude')).resolves.toBe('C:/bin/claude.exe');
    await expect(deps.resolveCommand('codex')).resolves.toBeNull();
    expect(deps.env.PATH).toBe('C:/bin');
  });

  it('describes provider construction inputs and model metadata', () => {
    const provider: ProviderConfig = {
      id: 'prov-claude',
      kind: 'claude',
      label: 'Claude subscription',
      config: { family: 'anthropic' },
      secret: null,
    };
    const model: ModelInfo = {
      id: 'claude-opus-4-5',
      label: 'Opus 4.5',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      isDefault: true,
    };

    expect(provider.kind).toBe('claude');
    expect(provider.secret).toBeNull();
    expect(model.contextWindow).toBe(200000);
    expect(model.maxOutputTokens).toBe(8192);
    expect(model.isDefault).toBe(true);

    // @ts-expect-error kind must be a ProviderKind
    const invalidProvider: ProviderConfig = { ...provider, kind: 'gemini' };
    expect(invalidProvider.kind).toBe('gemini');
  });

  it('resolves the root ProviderConfig to the adapter descriptor, not the stored config record', () => {
    const descriptor: ProviderConfig = {
      id: 'prov-claude',
      kind: 'claude',
      label: 'Claude subscription',
      config: { family: 'anthropic' },
      secret: 'sk-ant-test',
    };

    expect(Object.keys(descriptor).toSorted()).toEqual(['config', 'id', 'kind', 'label', 'secret']);
    expect(descriptor).toEqual({
      id: 'prov-claude',
      kind: 'claude',
      label: 'Claude subscription',
      config: { family: 'anthropic' },
      secret: 'sk-ant-test',
    });

    // @ts-expect-error the root ProviderConfig is the adapter descriptor, not the config record
    const storedRecord: ProviderConfig = { family: 'anthropic' };
    expect(storedRecord).toEqual({ family: 'anthropic' });
  });

  it('parses a stored provider config row with ProviderConfigSchema', () => {
    const storedRow = {
      family: 'anthropic',
      model: 'claude-opus-4-5',
      permissionMode: 'ask',
      allowedTools: ['bash', 'read'],
    };

    expect(ProviderConfigSchema.parse(storedRow)).toEqual(storedRow);
    expect(ProviderConfigSchema.parse({})).toEqual({});
    expect(ProviderConfigSchema.safeParse('not-a-row').success).toBe(false);
    expect(ProviderConfigSchema.safeParse(['family']).success).toBe(false);
  });

  it('types the provider token limits presets seed', () => {
    const seeded = { contextWindow: 200000, maxOutputTokens: 8192, family: 'openai' };
    expect(ProviderConfigSchema.parse(seeded)).toEqual(seeded);
    expect(ProviderConfigSchema.parse({ contextWindow: 200000 })).toEqual({
      contextWindow: 200000,
    });
    expect(ProviderConfigSchema.parse({ maxOutputTokens: 8192 })).toEqual({
      maxOutputTokens: 8192,
    });
    expect(ProviderConfigSchema.safeParse({ contextWindow: 0 }).success).toBe(false);
    expect(ProviderConfigSchema.safeParse({ contextWindow: -1 }).success).toBe(false);
    expect(ProviderConfigSchema.safeParse({ contextWindow: 1.5 }).success).toBe(false);
    expect(ProviderConfigSchema.safeParse({ maxOutputTokens: 0 }).success).toBe(false);
    expect(ProviderConfigSchema.safeParse({ maxOutputTokens: '8192' }).success).toBe(false);
  });
});

describe('AdapterUnavailableError', () => {
  it('carries the provider-unavailable code, provider id, and install hint', () => {
    const error = new AdapterUnavailableError(
      'prov-claude',
      'Install the Claude Code CLI and run claude login.',
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AdapterUnavailableError);
    expect(error.name).toBe('AdapterUnavailableError');
    expect(error.code).toBe('provider-unavailable');
    expect(error.providerId).toBe('prov-claude');
    expect(error.hint).toContain('claude login');
    expect(error.message).toContain('prov-claude');
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('spawn codex ENOENT');
    const error = new AdapterUnavailableError('prov-codex', 'Install codex.', { cause });

    expect(error.cause).toBe(cause);
  });
});

describe('package exports', () => {
  it('exposes the adapter surface from the package root', () => {
    expect(typeof contracts.AdapterUnavailableError).toBe('function');
    expect(Object.keys(contracts)).toContain('AdapterUnavailableError');
  });
});
