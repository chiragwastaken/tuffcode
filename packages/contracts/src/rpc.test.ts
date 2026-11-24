import { describe, expect, it } from 'vitest';
import {
  AdapterEventSchema,
  BrainEntrySchema,
  ClientRequestSchema,
  CommandSchema,
  DEFAULT_SETTINGS,
  DiffFileSchema,
  MessageSchema,
  ModelSchema,
  PROTOCOL_VERSION,
  ProjectSchema,
  ProviderViewSchema,
  RPC_METHODS,
  ReviewCommentSchema,
  RpcErrorCodeSchema,
  ServerEventFrameSchema,
  ServerEventSchema,
  ServerResponseSchema,
  SettingsPatchSchema,
  SettingsSchema,
  SubagentViewSchema,
  ThreadSchema,
  methods,
  type AdapterEvent,
  type Approval,
  type BrainEntry,
  type Checkpoint,
  type Command,
  type DiffFile,
  type Goal,
  type Message,
  type Model,
  type Project,
  type ProviderView,
  type Review,
  type ReviewComment,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type Skill,
  type SubagentView,
  type Task,
  type Thread,
  type ThreadEventRow,
} from './index.js';

const at = '2026-11-24T10:00:00.000Z';

const project: Project = {
  id: 'p1',
  name: 'tuffcode',
  path: 'C:/work/tuffcode',
  defaultBranch: 'main',
  createdAt: at,
  lastOpenedAt: null,
};

const thread: Thread = {
  id: 't1',
  projectId: 'p1',
  parentThreadId: null,
  title: 'Contracts',
  providerId: 'prov-claude',
  modelId: 'claude-opus-4-5',
  executionMode: 'work',
  permissionMode: 'ask',
  status: 'idle',
  worktreePath: 'C:/work/tuffcode-wt/contracts',
  branch: 'feat/contracts',
  baseBranch: 'main',
  prUrl: null,
  lastSeq: 12,
  createdAt: at,
  updatedAt: at,
};

const checkpoint: Checkpoint = {
  id: 'c1',
  threadId: 't1',
  ref: 'refs/tuffcode/checkpoints/c1',
  label: 'before review fixes',
  commitSha: 'abc123',
  createdAt: at,
};

const diffFile: DiffFile = {
  path: 'packages/contracts/src/rpc.ts',
  oldPath: null,
  status: 'modified',
  binary: false,
  additions: 10,
  deletions: 2,
  patch: '@@ -1,3 +1,4 @@',
};

const provider: ProviderView = {
  id: 'prov-claude',
  kind: 'claude',
  label: 'Claude subscription',
  config: { family: 'anthropic' },
  enabled: true,
  hasSecret: false,
  createdAt: at,
  updatedAt: at,
};

const model: Model = {
  providerId: 'prov-claude',
  modelId: 'claude-opus-4-5',
  label: 'Opus 4.5',
  contextWindow: 200000,
  maxOutputTokens: 8192,
  isDefault: true,
};

const subagentView: SubagentView = {
  childId: 'child-1',
  threadId: 't1',
  type: 'explorer',
  model: 'claude-opus-4-5',
  providerId: 'prov-claude',
  status: 'running',
  task: 'Map the contracts package',
  summary: 'Found the RPC registry',
  createdAt: at,
  updatedAt: at,
};

const brainEntry: BrainEntry = {
  id: 'b1',
  kind: 'rule',
  scope: 'global',
  projectId: null,
  text: 'Never use emdash characters',
  tags: 'style',
  appliesTo: 'all',
  importance: 0.9,
  useCount: 3,
  active: true,
  sourceQuote: 'never use emdash',
  createdAt: at,
  updatedAt: at,
  lastUsedAt: null,
};

const goal: Goal = {
  id: 'g1',
  threadId: 't1',
  text: 'Ship the contracts package',
  autonomy: 'auto',
  state: 'running',
  createdAt: at,
  reportedAt: null,
};

const task: Task = {
  id: 'k1',
  goalId: 'g1',
  threadId: 't1',
  title: 'Write entities',
  brief: 'TASK: write entities',
  state: 'running',
  authorProvider: 'claude',
  authorModel: 'claude-opus-4-5',
  reviewerProvider: 'codex',
  reviewerModel: 'gpt-5',
  critical: true,
  round: 1,
  error: null,
  createdAt: at,
  updatedAt: at,
};

const review: Review = {
  id: 'r1',
  taskId: 'k1',
  providerId: 'prov-codex',
  modelId: 'gpt-5',
  verdict: 'pass',
  body: 'Looks correct',
  createdAt: at,
};

const reviewComment: ReviewComment = {
  id: 'rc1',
  threadId: 't1',
  filePath: 'packages/contracts/src/rpc.ts',
  line: 12,
  side: 'new',
  body: 'This branch needs a test.',
  resolved: false,
  createdAt: at,
};

const command: Command = {
  name: 'review',
  description: 'Review the current diff',
  body: 'Review the diff and report findings',
  path: null,
  argumentHint: '[path]',
};

const skill: Skill = {
  name: 'deploy',
  description: 'Deploy the app',
  body: 'Run the deploy script',
  path: 'C:/work/tuffcode/.claude/skills/deploy/SKILL.md',
};

const approval: Approval = {
  id: 'ap1',
  threadId: 't1',
  toolCallId: 'call-1',
  toolName: 'bash',
  input: { command: 'rm -rf build' },
  decision: 'pending',
  createdAt: at,
  resolvedAt: null,
};

const threadEventRow: ThreadEventRow = {
  id: 1,
  threadId: 't1',
  seq: 1,
  type: 'text.delta',
  payload: { type: 'text.delta', turnId: 'turn-1', text: 'hello' },
  createdAt: at,
};

const message: Message = {
  id: 'm1',
  threadId: 't1',
  role: 'user',
  content: 'hello',
  createdAt: at,
};

const adapterEvents: AdapterEvent[] = [
  {
    type: 'session.started',
    sessionId: 'session-1',
    model: 'claude-opus-4-5',
    capabilities: { tools: true, approvals: true, resume: true },
  },
  { type: 'turn.started', turnId: 'turn-1' },
  { type: 'text.delta', turnId: 'turn-1', text: 'hello' },
  { type: 'reasoning.delta', turnId: 'turn-1', text: 'thinking' },
  {
    type: 'tool.started',
    turnId: 'turn-1',
    toolCallId: 'call-1',
    name: 'bash',
    input: { command: 'pnpm test' },
  },
  { type: 'tool.delta', turnId: 'turn-1', toolCallId: 'call-1', text: 'stdout' },
  {
    type: 'tool.finished',
    turnId: 'turn-1',
    toolCallId: 'call-1',
    output: 'ok',
    isError: false,
  },
  {
    type: 'approval.requested',
    turnId: 'turn-1',
    approvalId: 'ap1',
    toolCallId: 'call-1',
    name: 'write',
    input: { path: 'a.txt' },
  },
  { type: 'usage', turnId: 'turn-1', inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
  { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' },
  { type: 'error', message: 'rate limited', retryable: true },
  { type: 'session.ended', reason: 'disposed' },
];

type MethodFixture = {
  params: unknown;
  result: unknown;
};

const fixtures: Record<RpcMethod, MethodFixture> = {
  'app.health': {
    params: {},
    result: {
      version: '0.0.0',
      pid: 4321,
      uptimeMs: 1200,
      dbPath: 'C:/Users/Hp/AppData/Roaming/Tuffcode/tuffcode.db',
    },
  },
  'projects.list': { params: {}, result: [project] },
  'projects.add': { params: { path: 'C:/work/tuffcode' }, result: project },
  'projects.remove': { params: { id: 'p1', deleteWorktrees: true }, result: {} },
  'projects.refresh': { params: { id: 'p1' }, result: project },
  'threads.list': { params: { projectId: 'p1' }, result: [thread] },
  'threads.create': {
    params: {
      projectId: 'p1',
      title: 'Contracts',
      providerId: 'prov-claude',
      modelId: 'claude-opus-4-5',
      executionMode: 'work',
      permissionMode: 'ask',
      baseBranch: 'main',
    },
    result: thread,
  },
  'threads.get': { params: { id: 't1' }, result: thread },
  'threads.update': {
    params: { id: 't1', title: 'Renamed', permissionMode: 'accept-edits' },
    result: thread,
  },
  'threads.delete': { params: { id: 't1', removeWorktree: true }, result: {} },
  'threads.send': {
    params: {
      id: 't1',
      text: 'hello',
      attachments: [{ name: 'a.txt', path: 'C:/work/a.txt' }],
    },
    result: { turnId: 'turn-1' },
  },
  'threads.interrupt': { params: { id: 't1' }, result: {} },
  'threads.approve': {
    params: { threadId: 't1', approvalId: 'ap1', decision: 'allow-thread' },
    result: {},
  },
  'threads.events': {
    params: { id: 't1', sinceSeq: 0, limit: 100 },
    result: { events: [threadEventRow], hasMore: false },
  },
  'threads.context': {
    params: { threadId: 't1' },
    result: {
      usedTokens: 42000,
      maxTokens: 200000,
      percent: 0.21,
      compactedAt: at,
      segments: [
        { name: 'system', tokens: 640 },
        { name: 'messages', tokens: 41360 },
      ],
    },
  },
  'messages.list': { params: { threadId: 't1' }, result: [message] },
  'checkpoints.create': {
    params: { threadId: 't1', label: 'before review fixes' },
    result: checkpoint,
  },
  'checkpoints.list': { params: { threadId: 't1' }, result: [checkpoint] },
  'checkpoints.revert': { params: { threadId: 't1', checkpointId: 'c1' }, result: {} },
  'diff.get': { params: { threadId: 't1', checkpointId: 'c1' }, result: { files: [diffFile] } },
  'comments.list': { params: { threadId: 't1' }, result: [reviewComment] },
  'comments.add': {
    params: {
      threadId: 't1',
      filePath: 'packages/contracts/src/rpc.ts',
      line: 12,
      side: 'new',
      body: 'This branch needs a test.',
    },
    result: reviewComment,
  },
  'comments.resolve': { params: { id: 'rc1', resolved: true }, result: reviewComment },
  'git.commit': {
    params: { threadId: 't1', message: 'feat: contracts' },
    result: { sha: 'abc123' },
  },
  'git.push': {
    params: { threadId: 't1' },
    result: { branch: 'feat/contracts', remote: 'origin' },
  },
  'git.pr': {
    params: { threadId: 't1', title: 'Contracts', body: 'Adds contracts', draft: true },
    result: { url: 'https://github.com/tuffcode-net/tuffcode/pull/1', number: 1 },
  },
  'terminal.open': {
    params: { threadId: 't1', cols: 120, rows: 30 },
    result: { terminalId: 'term1' },
  },
  'terminal.input': { params: { terminalId: 'term1', data: 'ls\r' }, result: {} },
  'terminal.resize': { params: { terminalId: 'term1', cols: 100, rows: 40 }, result: {} },
  'terminal.close': { params: { terminalId: 'term1' }, result: {} },
  'providers.list': { params: {}, result: [provider] },
  'providers.upsert': {
    params: {
      kind: 'openai-compatible',
      label: 'Local model',
      config: { baseUrl: 'http://127.0.0.1:1234/v1', family: 'openai' },
      secret: 'sk-local',
    },
    result: provider,
  },
  'providers.remove': { params: { id: 'prov-claude' }, result: {} },
  'providers.test': {
    params: { id: 'prov-claude' },
    result: {
      ok: true,
      detail: 'signed in as user@example.com',
      signedIn: true,
      cliPath: 'C:/Users/Hp/AppData/Roaming/npm/claude.cmd',
      models: ['claude-opus-4-5', 'claude-sonnet-4-5'],
    },
  },
  'providers.login': {
    params: { id: 'prov-claude' },
    result: { loginId: 'login-1' },
  },
  'providers.loginCancel': {
    params: { loginId: 'login-1' },
    result: {},
  },
  'models.list': { params: { providerId: 'prov-claude' }, result: [model] },
  'providers.models': {
    params: { providerId: 'prov-claude', refresh: true },
    result: { models: [model], source: 'sdk' },
  },
  'settings.get': { params: {}, result: DEFAULT_SETTINGS },
  'settings.set': {
    params: { patch: { theme: 'light', brainEnabled: false } },
    result: DEFAULT_SETTINGS,
  },
  'prompt.preview': {
    params: { threadId: 't1', message: 'how do I run tests' },
    result: {
      sections: [
        { name: 'base', text: 'You are Tuffcode.', tokens: 640 },
        { name: 'custom', text: 'Prefer pnpm.', tokens: 12 },
        { name: 'user', text: 'how do I run tests', tokens: 8 },
      ],
      total: 660,
    },
  },
  'brain.list': {
    params: { kind: 'rule', projectId: 'p1', query: 'emdash', limit: 8, includeInactive: true },
    result: [brainEntry],
  },
  'brain.upsert': {
    params: {
      kind: 'preference',
      scope: 'global',
      projectId: 'p1',
      text: 'Prefer pnpm',
      tags: 'tooling',
      appliesTo: 'all',
      importance: 0.8,
      active: false,
    },
    result: brainEntry,
  },
  'brain.delete': { params: { id: 'b1' }, result: {} },
  'brain.preview': {
    params: { projectId: 'p1', threadId: 't1', message: 'how do I run tests' },
    result: { always: [brainEntry], retrieved: [brainEntry], tokens: 120 },
  },
  'brain.graph': {
    params: { projectId: 'p1', limit: 300 },
    result: {
      nodes: [
        { id: 'b1', kind: 'rule', label: 'Never use emdash', importance: 0.9, degree: 2 },
        { id: 'b2', kind: 'preference', label: 'Prefer pnpm', importance: 0.8, degree: 1 },
      ],
      edges: [{ from: 'b1', to: 'b2', relation: 'about' }],
    },
  },
  'memory.search': {
    params: { projectId: 'p1', query: 'emdash', limit: 8 },
    result: {
      entries: [
        {
          id: 'b1',
          kind: 'rule',
          text: 'Never use emdash characters',
          score: 0.87,
          reason: 'keyword match on "emdash"',
        },
      ],
    },
  },
  'council.start': {
    params: { threadId: 't1', goal: 'Ship the contracts package', autonomy: 'auto' },
    result: { goalId: 'g1' },
  },
  'council.cancel': { params: { goalId: 'g1' }, result: {} },
  'council.status': {
    params: { goalId: 'g1' },
    result: { goal, tasks: [task], reviews: [review] },
  },
  'subagents.spawn': {
    params: {
      threadId: 't1',
      spec: {
        type: 'worker',
        task: 'Implement the subagent RPC',
        model: 'claude-opus-4-5',
        providerId: 'prov-claude',
        worktree: true,
        budgetTokens: 20000,
      },
    },
    result: { childId: 'child-1' },
  },
  'subagents.cancel': { params: { childId: 'child-1' }, result: {} },
  'subagents.list': { params: { threadId: 't1' }, result: [subagentView] },
  'commands.list': { params: { projectId: 'p1' }, result: [command] },
  'commands.run': {
    params: { threadId: 't1', input: '/context' },
    result: {
      kind: 'ui',
      action: {
        type: 'show-context',
        preview: {
          sections: [{ name: 'base', text: 'You are Tuffcode.', tokens: 6 }],
          total: 6,
        },
      },
    },
  },
  'skills.list': { params: { projectId: 'p1' }, result: [skill] },
  'diagnostics.export': {
    params: {},
    result: { path: 'C:/Users/Hp/AppData/Local/Tuffcode/logs/diagnostics.zip' },
  },
};

const expectedMethods: RpcMethod[] = [
  'app.health',
  'brain.delete',
  'brain.graph',
  'brain.list',
  'brain.preview',
  'brain.upsert',
  'checkpoints.create',
  'checkpoints.list',
  'checkpoints.revert',
  'commands.list',
  'commands.run',
  'comments.add',
  'comments.list',
  'comments.resolve',
  'council.cancel',
  'council.start',
  'council.status',
  'diagnostics.export',
  'diff.get',
  'git.commit',
  'git.pr',
  'git.push',
  'memory.search',
  'messages.list',
  'models.list',
  'projects.add',
  'projects.list',
  'projects.refresh',
  'projects.remove',
  'prompt.preview',
  'providers.list',
  'providers.login',
  'providers.loginCancel',
  'providers.models',
  'providers.remove',
  'providers.test',
  'providers.upsert',
  'settings.get',
  'settings.set',
  'skills.list',
  'subagents.cancel',
  'subagents.list',
  'subagents.spawn',
  'terminal.close',
  'terminal.input',
  'terminal.open',
  'terminal.resize',
  'threads.approve',
  'threads.context',
  'threads.create',
  'threads.delete',
  'threads.events',
  'threads.get',
  'threads.interrupt',
  'threads.list',
  'threads.send',
  'threads.update',
];

describe('protocol envelope', () => {
  it('pins protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('round-trips a client request', () => {
    const request = { id: 'req-1', method: 'app.health', params: {} };
    expect(ClientRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects malformed client requests', () => {
    expect(
      ClientRequestSchema.safeParse({ id: '', method: 'app.health', params: {} }).success,
    ).toBe(false);
    expect(ClientRequestSchema.safeParse({ method: 'app.health', params: {} }).success).toBe(false);
    expect(ClientRequestSchema.safeParse({ id: 'req-1', method: '', params: {} }).success).toBe(
      false,
    );
  });

  it('round-trips an ok response and narrows on ok', () => {
    const response = { id: 'req-1', ok: true, result: { version: '0.0.0' } };
    const parsed = ServerResponseSchema.parse(response);
    expect(parsed).toEqual(response);
    if (parsed.ok) {
      expect(parsed.result).toEqual({ version: '0.0.0' });
    } else {
      throw new Error('expected ok response');
    }
  });

  it('round-trips an error response with details', () => {
    const response = {
      id: 'req-2',
      ok: false,
      error: { code: 'conflict', message: 'thread is running', details: { retryAfterMs: 500 } },
    };
    const parsed = ServerResponseSchema.parse(response);
    expect(parsed).toEqual(response);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('conflict');
    }
  });

  it('rejects invalid responses', () => {
    expect(ServerResponseSchema.safeParse({ id: 'req-1', ok: true }).success).toBe(false);
    expect(
      ServerResponseSchema.safeParse({
        id: 'req-1',
        ok: false,
        error: { code: 'teapot', message: 'nope' },
      }).success,
    ).toBe(false);
    expect(ServerResponseSchema.safeParse({ id: 'req-1', ok: 'yes', result: {} }).success).toBe(
      false,
    );
  });

  it('exposes exactly the seven error codes', () => {
    expect(RpcErrorCodeSchema.options).toEqual([
      'unauthorized',
      'bad-request',
      'not-found',
      'conflict',
      'provider-unavailable',
      'permission-denied',
      'internal',
    ]);
  });
});

function parseCommandRunResult(result: unknown) {
  return methods['commands.run'].result.safeParse(result);
}

describe('rpc methods', () => {
  it('exposes exactly 56 methods with the documented names', () => {
    expect(RPC_METHODS).toHaveLength(56);
    expect(RPC_METHODS.toSorted()).toEqual(expectedMethods);
    expect(Object.keys(fixtures).toSorted()).toEqual(expectedMethods);
    expect(Object.keys(methods).toSorted()).toEqual(expectedMethods);
  });

  it('parses valid params and results for every method', () => {
    for (const [method, fixture] of Object.entries(fixtures) as Array<[RpcMethod, MethodFixture]>) {
      expect(methods[method].params.parse(fixture.params), `${method} params`).toEqual(
        fixture.params,
      );
      expect(methods[method].result.parse(fixture.result), `${method} result`).toEqual(
        fixture.result,
      );
    }
  });

  it('accepts the round 2 methods with optional fields omitted', () => {
    expect(
      methods['providers.models'].params.safeParse({ providerId: 'prov-claude' }).success,
    ).toBe(true);
    expect(
      methods['providers.models'].result.safeParse({ models: [], source: 'manual' }).success,
    ).toBe(true);
    expect(
      methods['providers.models'].result.safeParse({
        models: [],
        source: 'cache',
        error: 'claude CLI not found',
      }).success,
    ).toBe(true);
    expect(methods['prompt.preview'].result.safeParse({ sections: [], total: 0 }).success).toBe(
      true,
    );
    expect(
      methods['subagents.spawn'].params.safeParse({
        threadId: 't1',
        spec: { type: 'notetaker', task: 'Distill the thread' },
      }).success,
    ).toBe(true);
    expect(methods['subagents.list'].result.safeParse([]).success).toBe(true);
    expect(
      methods['subagents.list'].result.safeParse([{ ...subagentView, summary: undefined }]).success,
    ).toBe(true);
    expect(methods['brain.graph'].params.safeParse({}).success).toBe(true);
    expect(methods['brain.graph'].result.safeParse({ nodes: [], edges: [] }).success).toBe(true);
    expect(methods['memory.search'].params.safeParse({ query: 'emdash' }).success).toBe(true);
    expect(methods['memory.search'].result.safeParse({ entries: [] }).success).toBe(true);
    expect(
      methods['threads.context'].result.safeParse({
        usedTokens: 0,
        maxTokens: 200000,
        percent: 0,
        segments: [],
      }).success,
    ).toBe(true);
    expect(
      methods['providers.models'].result.safeParse({
        models: [{ providerId: 'prov-claude', modelId: 'm', label: 'M', isDefault: false }],
        source: 'manual',
      }).success,
    ).toBe(true);
    expect(
      methods['providers.upsert'].params.safeParse({
        kind: 'openai-compatible',
        label: 'Local',
        config: { contextWindow: 200000, maxOutputTokens: 8192, baseUrl: 'http://127.0.0.1:1/v1' },
      }).success,
    ).toBe(true);
  });

  it('parses every commands.run result kind', () => {
    expect(parseCommandRunResult({ kind: 'text', text: '/model opens the picker.' }).success).toBe(
      true,
    );
    expect(parseCommandRunResult({ kind: 'turn', text: '/review src/app.ts' }).success).toBe(true);
    expect(parseCommandRunResult({ kind: 'error', message: 'Unknown subagent type' }).success).toBe(
      true,
    );
    expect(
      parseCommandRunResult({ kind: 'ui', action: { type: 'open-model-picker' } }).success,
    ).toBe(true);
    expect(
      parseCommandRunResult({ kind: 'ui', action: { type: 'switch-mode', mode: 'council' } })
        .success,
    ).toBe(true);
    expect(
      parseCommandRunResult({
        kind: 'ui',
        action: { type: 'open-settings', section: 'instructions' },
      }).success,
    ).toBe(true);
    expect(
      parseCommandRunResult({
        kind: 'ui',
        action: { type: 'reload-transcript', text: 'Cleared 3 messages.' },
      }).success,
    ).toBe(true);
    expect(
      parseCommandRunResult({ kind: 'ui', action: { type: 'switch-mode', mode: 'turbo' } }).success,
    ).toBe(false);
    expect(
      parseCommandRunResult({ kind: 'ui', action: { type: 'open-settings', section: 'billing' } })
        .success,
    ).toBe(false);
    expect(parseCommandRunResult({ kind: 'ui', action: { type: 'show-context' } }).success).toBe(
      false,
    );
    expect(parseCommandRunResult({ kind: 'text' }).success).toBe(false);
  });

  it('rejects null params and results for every method', () => {
    for (const method of RPC_METHODS) {
      expect(methods[method].params.safeParse(null).success, `${method} params`).toBe(false);
      expect(methods[method].result.safeParse(null).success, `${method} result`).toBe(false);
    }
  });

  it('rejects wrong field values', () => {
    const cases: Array<[RpcMethod, 'params' | 'result', unknown]> = [
      [
        'threads.create',
        'params',
        { ...(fixtures['threads.create'].params as object), executionMode: 'yolo' },
      ],
      [
        'threads.create',
        'params',
        { projectId: 'p1', modelId: 'm', executionMode: 'work', permissionMode: 'ask' },
      ],
      ['threads.approve', 'params', { threadId: 't1', approvalId: 'ap1', decision: 'pending' }],
      ['threads.events', 'params', { id: 't1', sinceSeq: -1 }],
      ['terminal.open', 'params', { threadId: 't1', cols: 0, rows: 30 }],
      ['providers.upsert', 'params', { kind: 'gemini', label: 'x', config: {} }],
      [
        'brain.upsert',
        'params',
        { kind: 'preference', scope: 'global', text: 'x', importance: 1.5 },
      ],
      ['brain.upsert', 'params', { kind: 'preference', scope: 'global', text: 'x', active: 'yes' }],
      ['brain.upsert', 'params', { kind: 'preference', scope: 'global', text: 'x', projectId: 7 }],
      ['brain.list', 'params', { includeInactive: 1 }],
      ['settings.set', 'params', { patch: { theme: 'blue' } }],
      ['projects.add', 'params', { path: '' }],
      ['git.pr', 'result', { url: 'https://example.test/pr/1', number: 0 }],
      ['app.health', 'result', { version: '1', pid: 1, uptimeMs: 1 }],
      ['council.status', 'result', { goal, tasks: 'none', reviews: [] }],
      ['providers.test', 'result', { ok: true }],
      ['brain.list', 'result', [brainEntry, { ...brainEntry, importance: 2 }]],
      [
        'comments.add',
        'params',
        { threadId: 't1', filePath: 'a.ts', line: 1, side: 'both', body: 'x' },
      ],
      [
        'comments.add',
        'params',
        { threadId: 't1', filePath: 'a.ts', line: 0, side: 'new', body: 'x' },
      ],
      ['comments.resolve', 'params', { id: 'rc1' }],
      ['comments.list', 'result', [{ ...reviewComment, line: -1 }]],
      ['providers.test', 'result', { ok: true, detail: 'x', signedIn: 'yes' }],
      ['providers.test', 'result', { ok: true, detail: 'x', models: 'claude-opus-4-5' }],
      ['providers.login', 'params', { id: '' }],
      ['providers.loginCancel', 'params', { loginId: '' }],
      ['messages.list', 'params', { threadId: '' }],
      ['messages.list', 'result', [{ ...message, role: 'bot' }]],
      ['providers.models', 'params', { providerId: '' }],
      ['providers.models', 'result', { models: [], source: 'guess' }],
      ['providers.models', 'result', { models: [{ ...model, contextWindow: 0 }], source: 'cache' }],
      [
        'providers.models',
        'result',
        { models: [{ ...model, maxOutputTokens: 0 }], source: 'cache' },
      ],
      [
        'providers.models',
        'result',
        { models: [{ ...model, maxOutputTokens: 1.5 }], source: 'cache' },
      ],
      ['threads.context', 'params', { threadId: '' }],
      [
        'threads.context',
        'result',
        { usedTokens: -1, maxTokens: 200000, percent: 0, segments: [] },
      ],
      ['threads.context', 'result', { usedTokens: 1, maxTokens: 0, percent: 0, segments: [] }],
      [
        'threads.context',
        'result',
        { usedTokens: 1, maxTokens: 200000, percent: 1.5, segments: [] },
      ],
      [
        'threads.context',
        'result',
        { usedTokens: 1, maxTokens: 200000, percent: 0.5, segments: [{ name: 'x', tokens: -1 }] },
      ],
      ['threads.context', 'result', { usedTokens: 1, maxTokens: 200000, percent: 0.5 }],
      [
        'threads.context',
        'result',
        {
          usedTokens: 1,
          maxTokens: 200000,
          percent: 0.5,
          compactedAt: 'yesterday',
          segments: [],
        },
      ],
      [
        'providers.upsert',
        'params',
        { kind: 'openai-compatible', label: 'x', config: { contextWindow: 0 } },
      ],
      [
        'providers.upsert',
        'params',
        { kind: 'openai-compatible', label: 'x', config: { maxOutputTokens: -1 } },
      ],
      ['prompt.preview', 'params', { threadId: 't1' }],
      [
        'prompt.preview',
        'result',
        { sections: [{ name: 'base', text: 'x', tokens: -1 }], total: 0 },
      ],
      ['prompt.preview', 'result', { sections: [], total: 1.5 }],
      ['subagents.spawn', 'params', { threadId: 't1', spec: { type: 'janitor', task: 'x' } }],
      ['subagents.spawn', 'params', { threadId: 't1', spec: { type: 'worker', task: '' } }],
      [
        'subagents.spawn',
        'params',
        { threadId: 't1', spec: { type: 'worker', task: 'x', budgetTokens: 0 } },
      ],
      ['subagents.spawn', 'result', { childId: '' }],
      ['subagents.cancel', 'params', { childId: '' }],
      ['subagents.list', 'params', { threadId: '' }],
      ['subagents.list', 'result', [{ ...subagentView, status: 'paused' }]],
      ['brain.graph', 'params', { limit: 0 }],
      [
        'brain.graph',
        'result',
        {
          nodes: [{ id: 'b1', kind: 'rule', label: 'x', importance: 2, degree: 0 }],
          edges: [],
        },
      ],
      ['brain.graph', 'result', { nodes: [], edges: [{ from: 'b1', to: 'b2', relation: '' }] }],
      ['commands.run', 'params', { threadId: 't1', input: '' }],
      ['commands.run', 'params', { threadId: '', input: '/help' }],
      ['commands.run', 'result', { kind: 'turn' }],
      ['commands.run', 'result', { kind: 'ui', action: { type: 'open-settings' } }],
      ['commands.run', 'result', { kind: 'nope', text: 'x' }],
      ['memory.search', 'params', { query: '' }],
      ['memory.search', 'params', { projectId: 'p1', query: 'emdash', limit: -1 }],
      [
        'memory.search',
        'result',
        { entries: [{ id: 'b1', kind: 'rule', text: 'x', score: -1, reason: 'r' }] },
      ],
      [
        'memory.search',
        'result',
        { entries: [{ id: 'b1', kind: 'idea', text: 'x', score: 1, reason: 'r' }] },
      ],
    ];

    for (const [method, side, value] of cases) {
      expect(methods[method][side].safeParse(value).success, `${method} ${side}`).toBe(false);
    }
  });

  it('keeps params and results typed for callers', () => {
    const sendParams: RpcParams<'threads.send'> = { id: 't1', text: 'hello' };
    const health: RpcResult<'app.health'> = {
      version: '0.0.0',
      pid: 1,
      uptimeMs: 0,
      dbPath: 'db.sqlite',
    };
    const method: RpcMethod = 'app.health';
    expect(sendParams.text).toBe('hello');
    expect(health.pid).toBe(1);
    expect(method).toBe('app.health');

    const invalidApproval: RpcParams<'threads.approve'> = {
      threadId: 't1',
      approvalId: 'ap1',
      // @ts-expect-error pending is a stored approval state, not a resolvable decision
      decision: 'pending',
    };
    expect(invalidApproval.decision).toBe('pending');

    // @ts-expect-error thread results require every thread field
    const invalidThread: RpcResult<'threads.get'> = { id: 't1' };
    expect(invalidThread.id).toBe('t1');
  });
});

describe('adapter events', () => {
  it('parses every adapter event variant', () => {
    for (const event of adapterEvents) {
      const parsed = AdapterEventSchema.parse(event);
      expect(parsed.type).toBe(event.type);
    }
  });

  it('rejects unknown event types and invalid variants', () => {
    expect(AdapterEventSchema.safeParse({ type: 'thread.removed' }).success).toBe(false);
    expect(
      AdapterEventSchema.safeParse({ type: 'turn.finished', turnId: 'turn-1', reason: 'done' })
        .success,
    ).toBe(false);
    expect(
      AdapterEventSchema.safeParse({ type: 'usage', turnId: 'turn-1', inputTokens: -1 }).success,
    ).toBe(false);
    expect(AdapterEventSchema.safeParse({ type: 'text.delta', turnId: 'turn-1' }).success).toBe(
      false,
    );
  });

  it('carries adapter events in replay rows', () => {
    expect(threadEventRow.payload.type).toBe('text.delta');
    expect(
      methods['threads.events'].result.safeParse({ events: [threadEventRow], hasMore: false })
        .success,
    ).toBe(true);
    expect(
      methods['threads.events'].result.safeParse({
        events: [{ ...threadEventRow, payload: { type: 'nope' } }],
        hasMore: false,
      }).success,
    ).toBe(false);
  });
});

describe('server events', () => {
  it('discriminates thread.event and keeps the adapter payload typed', () => {
    const frame = {
      kind: 'event',
      type: 'thread.event',
      threadId: 't1',
      seq: 7,
      payload: { type: 'text.delta', turnId: 'turn-1', text: 'hello' },
    };
    const parsed = ServerEventSchema.parse(frame);
    expect(parsed.type).toBe('thread.event');
    if (parsed.type === 'thread.event') {
      expect(parsed.seq).toBe(7);
      if (parsed.payload.type === 'text.delta') {
        expect(parsed.payload.text).toBe('hello');
      }
    }
    expect(ServerEventFrameSchema.parse(frame)).toEqual(frame);
  });

  it('parses every server event variant', () => {
    const frames = [
      { kind: 'event', type: 'thread.updated', payload: thread },
      {
        kind: 'event',
        type: 'thread.event',
        threadId: 't1',
        seq: 8,
        payload: { type: 'turn.started', turnId: 'turn-2' },
      },
      { kind: 'event', type: 'approval.requested', payload: approval },
      { kind: 'event', type: 'terminal.data', payload: { terminalId: 'term1', data: 'ok' } },
      { kind: 'event', type: 'council.updated', payload: { goalId: 'g1', state: 'reviewing' } },
      {
        kind: 'event',
        type: 'subagent.started',
        payload: {
          childId: 'child-1',
          threadId: 't1',
          type: 'explorer',
          model: 'claude-opus-4-5',
        },
      },
      {
        kind: 'event',
        type: 'subagent.event',
        payload: {
          childId: 'child-1',
          threadId: 't1',
          event: { type: 'text.delta', turnId: 'turn-1', text: 'mapping files' },
        },
      },
      {
        kind: 'event',
        type: 'subagent.finished',
        payload: {
          childId: 'child-1',
          threadId: 't1',
          status: 'done',
          summary: 'Mapped 5 files',
        },
      },
      { kind: 'event', type: 'providers.updated', payload: [provider] },
      {
        kind: 'event',
        type: 'provider.login.output',
        payload: { loginId: 'login-1', providerId: 'prov-claude', chunk: 'Visit the URL' },
      },
      {
        kind: 'event',
        type: 'provider.login.done',
        payload: { loginId: 'login-1', providerId: 'prov-claude', ok: true, detail: 'signed in' },
      },
      { kind: 'event', type: 'settings.updated', payload: DEFAULT_SETTINGS },
      {
        kind: 'event',
        type: 'context.updated',
        payload: {
          threadId: 't1',
          usedTokens: 42000,
          maxTokens: 200000,
          percent: 0.21,
          compacted: false,
        },
      },
      { kind: 'event', type: 'server.warning', payload: { message: 'disk low', code: 'disk' } },
    ];

    expect(frames).toHaveLength(14);
    for (const frame of frames) {
      expect(ServerEventSchema.safeParse(frame).success, frame.type).toBe(true);
    }
  });

  it('rejects unknown event types and missing thread context', () => {
    expect(
      ServerEventSchema.safeParse({ kind: 'event', type: 'thread.removed', payload: {} }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'thread.event',
        threadId: 't1',
        payload: { type: 'text.delta', turnId: 'turn-1', text: 'x' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({ kind: 'response', type: 'thread.updated', payload: thread })
        .success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'provider.login.output',
        payload: { loginId: 'login-1', providerId: 'prov-claude' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'provider.login.done',
        payload: { loginId: 'login-1', providerId: 'prov-claude', ok: 'yes', detail: 'signed in' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'subagent.started',
        payload: { childId: 'child-1', threadId: 't1', type: 'janitor', model: 'm' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'subagent.started',
        payload: { childId: 'child-1', threadId: 't1', type: 'explorer' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'subagent.event',
        payload: { childId: 'child-1', threadId: 't1', event: { type: 'nope' } },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'subagent.finished',
        payload: { childId: 'child-1', threadId: 't1', status: 'paused' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'subagent.finished',
        payload: { childId: 'child-1', status: 'done' },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'context.updated',
        payload: {
          threadId: 't1',
          usedTokens: 42000,
          maxTokens: 200000,
          percent: 1.2,
          compacted: false,
        },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'context.updated',
        payload: { usedTokens: 42000, maxTokens: 200000, percent: 0.2, compacted: false },
      }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: 'event',
        type: 'context.updated',
        payload: {
          threadId: 't1',
          usedTokens: 42000,
          maxTokens: 200000,
          percent: 0.2,
          compacted: 'yes',
        },
      }).success,
    ).toBe(false);
  });
});

describe('settings', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'dark',
      shell: null,
      defaultPermissionMode: 'ask',
      defaultProviderId: null,
      defaultModelId: null,
      worktreeRoot: null,
      logLevel: 'info',
      brainEnabled: true,
      updateChannel: 'stable',
      keybindings: {},
      interfaceSize: 'default',
      fontSize: 14,
      sidebarWidth: 256,
      panelAnimation: false,
      maxToolIterations: 40,
      enabledTools: ['bash', 'read', 'edit', 'write', 'glob', 'grep'],
      terminalScrollback: 5000,
      terminalFontSize: 13,
      cursorStyle: 'bar',
      checkUpdatesOnStart: true,
      customInstructions: '',
      subagentModels: {
        explorer: {},
        reviewer: {},
        notetaker: {},
        worker: {},
        planner: {},
      },
      subagentConcurrency: 4,
      contextWarningThreshold: 0.8,
      autoCompact: true,
      maxOutputTokens: 8192,
      showContextMeter: true,
    });
    expect(SettingsSchema.parse({})).toEqual(DEFAULT_SETTINGS);
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(SettingsSchema.parse({}).keybindings).not.toBe(DEFAULT_SETTINGS.keybindings);
    expect(SettingsSchema.parse({}).enabledTools).not.toBe(DEFAULT_SETTINGS.enabledTools);
    expect(SettingsSchema.parse({}).subagentModels).not.toBe(DEFAULT_SETTINGS.subagentModels);
    expect(SettingsSchema.parse({})).not.toHaveProperty('paneLayout');
  });

  it('parses partial patches without filling defaults', () => {
    expect(SettingsPatchSchema.parse({})).toEqual({});
    expect(SettingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' });
    expect(SettingsPatchSchema.parse({ fontSize: 16, cursorStyle: 'block' })).toEqual({
      fontSize: 16,
      cursorStyle: 'block',
    });
    expect(SettingsPatchSchema.parse({ enabledTools: ['read', 'grep'] })).toEqual({
      enabledTools: ['read', 'grep'],
    });
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, theme: 'blue' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, logLevel: 'verbose' }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, fontSize: 30 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, fontSize: 13.5 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sidebarWidth: 400 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, maxToolIterations: 0 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, terminalFontSize: 10 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, interfaceSize: 'huge' }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, cursorStyle: 'beam' }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, enabledTools: 'bash' }).success).toBe(
      false,
    );
    expect(
      SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, contextWarningThreshold: 0.4 }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, contextWarningThreshold: 0.96 }).success,
    ).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, autoCompact: 'yes' }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, maxOutputTokens: 255 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, maxOutputTokens: 65537 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, maxOutputTokens: 8192.5 }).success).toBe(
      false,
    );
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, showContextMeter: 1 }).success).toBe(
      false,
    );
  });

  it('parses context limit settings and patches', () => {
    const parsed = SettingsSchema.parse({
      contextWarningThreshold: 0.95,
      autoCompact: false,
      maxOutputTokens: 256,
      showContextMeter: false,
    });
    expect(parsed.contextWarningThreshold).toBe(0.95);
    expect(parsed.autoCompact).toBe(false);
    expect(parsed.maxOutputTokens).toBe(256);
    expect(parsed.showContextMeter).toBe(false);

    expect(SettingsSchema.parse({ contextWarningThreshold: 0.5 }).contextWarningThreshold).toBe(
      0.5,
    );
    expect(SettingsSchema.parse({ maxOutputTokens: 65536 }).maxOutputTokens).toBe(65536);
    expect(SettingsPatchSchema.parse({ autoCompact: false })).toEqual({ autoCompact: false });
    expect(SettingsPatchSchema.safeParse({ contextWarningThreshold: 0.99 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ maxOutputTokens: 100 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ showContextMeter: 'on' }).success).toBe(false);
  });

  it('parses custom instructions, subagent models and concurrency', () => {
    const parsed = SettingsSchema.parse({
      customInstructions: 'Prefer pnpm and never use emdash.',
      subagentModels: { worker: { model: 'claude-opus-4-5', fallbackModel: 'gpt-5' } },
      subagentConcurrency: 6,
    });
    expect(parsed.customInstructions).toBe('Prefer pnpm and never use emdash.');
    expect(parsed.subagentModels).toEqual({
      explorer: {},
      reviewer: {},
      notetaker: {},
      worker: { model: 'claude-opus-4-5', fallbackModel: 'gpt-5' },
      planner: {},
    });
    expect(parsed.subagentConcurrency).toBe(6);

    expect(
      SettingsSchema.parse({ customInstructions: 'x'.repeat(4000) }).customInstructions,
    ).toHaveLength(4000);
    expect(SettingsSchema.parse({ subagentConcurrency: 1 }).subagentConcurrency).toBe(1);
    expect(SettingsSchema.parse({ subagentConcurrency: 8 }).subagentConcurrency).toBe(8);
    expect(SettingsSchema.safeParse({ customInstructions: 'x'.repeat(4001) }).success).toBe(false);
    expect(SettingsSchema.safeParse({ customInstructions: 12 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ subagentConcurrency: 0 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ subagentConcurrency: 9 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ subagentConcurrency: 4.5 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ subagentModels: { explorer: { model: 7 } } }).success).toBe(
      false,
    );
    expect(
      SettingsSchema.safeParse({ subagentModels: { explorer: { providerId: 'p1' } } }).success,
    ).toBe(true);
    expect(SettingsPatchSchema.parse({ customInstructions: 'be brief' })).toEqual({
      customInstructions: 'be brief',
    });
    expect(SettingsPatchSchema.safeParse({ subagentConcurrency: 9 }).success).toBe(false);
  });

  it('keeps paneLayout optional and opaque', () => {
    const layout = { panes: [{ id: 'pane-1', kind: 'thread', threadId: 't1', width: 0.5 }] };
    expect(SettingsSchema.parse({ paneLayout: layout }).paneLayout).toEqual(layout);
    expect(SettingsPatchSchema.parse({ paneLayout: layout })).toEqual({ paneLayout: layout });
  });
});

describe('entity schemas', () => {
  it('round-trips every entity fixture', () => {
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(ThreadSchema.parse(thread)).toEqual(thread);
    expect(MessageSchema.parse(message)).toEqual(message);
    expect(ProviderViewSchema.parse(provider)).toEqual(provider);
    expect(ModelSchema.parse(model)).toEqual(model);
    expect(SubagentViewSchema.parse(subagentView)).toEqual(subagentView);
    expect(BrainEntrySchema.parse(brainEntry)).toEqual(brainEntry);
    expect(DiffFileSchema.parse(diffFile)).toEqual(diffFile);
    expect(ReviewCommentSchema.parse(reviewComment)).toEqual(reviewComment);
    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it('keeps model token limits optional and positive', () => {
    const withoutLimits = {
      providerId: 'prov-claude',
      modelId: 'claude-opus-4-5',
      label: 'Opus 4.5',
      isDefault: false,
    };
    expect(ModelSchema.parse(withoutLimits)).toEqual(withoutLimits);
    expect(ModelSchema.parse({ ...model, contextWindow: null })).toEqual({
      ...model,
      contextWindow: null,
    });
    expect(ModelSchema.safeParse({ ...model, maxOutputTokens: null }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, contextWindow: 0 }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, contextWindow: -1 }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, contextWindow: 1.5 }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, maxOutputTokens: 0 }).success).toBe(false);
    expect(ModelSchema.safeParse({ ...model, maxOutputTokens: 255.5 }).success).toBe(false);
  });

  it('rejects entities with invalid enum values', () => {
    expect(ThreadSchema.safeParse({ ...thread, status: 'paused' }).success).toBe(false);
    expect(ThreadSchema.safeParse({ ...thread, executionMode: 'chat' }).success).toBe(false);
    expect(ThreadSchema.safeParse({ ...thread, permissionMode: 'yolo' }).success).toBe(false);
    expect(ProviderViewSchema.safeParse({ ...provider, kind: 'gemini' }).success).toBe(false);
    expect(BrainEntrySchema.safeParse({ ...brainEntry, kind: 'idea' }).success).toBe(false);
    expect(DiffFileSchema.safeParse({ ...diffFile, status: 'unknown' }).success).toBe(false);
    expect(ReviewCommentSchema.safeParse({ ...reviewComment, side: 'both' }).success).toBe(false);
    expect(MessageSchema.safeParse({ ...message, role: 'bot' }).success).toBe(false);
  });

  it('accepts every provider kind including anthropic', () => {
    const kinds = ['claude', 'codex', 'acp', 'opencode', 'openai-compatible', 'anthropic'];
    for (const kind of kinds) {
      expect(ProviderViewSchema.safeParse({ ...provider, kind }).success, kind).toBe(true);
    }
  });
});
