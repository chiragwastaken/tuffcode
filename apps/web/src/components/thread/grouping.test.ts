import type { AdapterEvent, ThreadEventRow } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  groupTimeline,
  collapseToolRuns,
  toolGroupSummary,
  toolInputText,
  toolSummary,
  type LocalUserMessage,
  type TimelineItem,
} from './grouping';

function event(seq: number, payload: AdapterEvent): ThreadEventRow {
  return {
    id: seq + 1,
    threadId: 'thread-1',
    seq,
    type: payload.type,
    payload,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function message(overrides: Partial<LocalUserMessage> = {}): LocalUserMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    text: 'Do the thing',
    attachments: [],
    ...overrides,
  };
}

describe('groupTimeline', () => {
  it('places a sent user message before its turn and merges text deltas into one assistant row', () => {
    const items = groupTimeline({
      events: [
        event(1, { type: 'turn.started', turnId: 'turn-1' }),
        event(2, { type: 'text.delta', turnId: 'turn-1', text: 'Hel' }),
        event(3, { type: 'text.delta', turnId: 'turn-1', text: 'lo' }),
        event(4, { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' }),
      ],
      userMessages: [message()],
      approvals: {},
    });

    expect(items.map((item) => item.kind)).toEqual(['user', 'assistant']);
    const assistant = items[1];
    if (assistant?.kind !== 'assistant') throw new Error('Expected an assistant row.');
    expect(assistant.text).toBe('Hello');
    expect(assistant.streaming).toBe(false);
  });

  it('keeps the assistant row open until the turn finishes', () => {
    const items = groupTimeline({
      events: [event(1, { type: 'text.delta', turnId: 'turn-1', text: 'Working' })],
      userMessages: [],
      approvals: {},
    });

    const assistant = items[0];
    if (assistant?.kind !== 'assistant') throw new Error('Expected an assistant row.');
    expect(assistant.streaming).toBe(true);
  });

  it('folds tool started, delta and finished into one compact row', () => {
    const items = groupTimeline({
      events: [
        event(1, {
          type: 'tool.started',
          turnId: 'turn-1',
          toolCallId: 'call-1',
          name: 'read_file',
          input: { path: 'src/app.ts' },
        }),
        event(2, { type: 'tool.delta', turnId: 'turn-1', toolCallId: 'call-1', text: 'partial' }),
        event(3, {
          type: 'tool.finished',
          turnId: 'turn-1',
          toolCallId: 'call-1',
          output: 'final output',
          isError: false,
        }),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items).toHaveLength(1);
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('Expected a tool row.');
    expect(tool.name).toBe('read_file');
    expect(tool.output).toBe('final output');
    expect(tool.running).toBe(false);
    expect(tool.isError).toBe(false);
    expect(toolSummary(tool.input)).toBe('src/app.ts');
  });

  it('marks a tool row running and error states from the event stream', () => {
    const items = groupTimeline({
      events: [
        event(1, {
          type: 'tool.started',
          turnId: 'turn-1',
          toolCallId: 'call-1',
          name: 'shell',
          input: { command: 'pnpm test' },
        }),
        event(2, {
          type: 'tool.finished',
          turnId: 'turn-1',
          toolCallId: 'call-1',
          output: 'exit 1',
          isError: true,
        }),
      ],
      userMessages: [],
      approvals: {},
    });

    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('Expected a tool row.');
    expect(tool.isError).toBe(true);
    expect(tool.running).toBe(false);
    expect(toolSummary(tool.input)).toBe('pnpm test');
  });

  it('carries the local approval decision into the approval row', () => {
    const items = groupTimeline({
      events: [
        event(1, {
          type: 'approval.requested',
          turnId: 'turn-1',
          approvalId: 'approval-1',
          toolCallId: 'call-1',
          name: 'write_file',
          input: { path: 'README.md' },
        }),
      ],
      userMessages: [],
      approvals: { 'approval-1': 'deny' },
    });

    const approval = items[0];
    if (approval?.kind !== 'approval') throw new Error('Expected an approval row.');
    expect(approval.decision).toBe('deny');
    expect(approval.name).toBe('write_file');
  });

  it('orders multiple turns and appends messages whose turn never produced events', () => {
    const items = groupTimeline({
      events: [
        event(1, { type: 'text.delta', turnId: 'turn-1', text: 'First' }),
        event(2, { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' }),
        event(3, { type: 'text.delta', turnId: 'turn-2', text: 'Second' }),
      ],
      userMessages: [
        message({ id: 'm1', turnId: 'turn-1', text: 'One' }),
        message({ id: 'm2', turnId: 'turn-2', text: 'Two' }),
        message({ id: 'm3', turnId: 'turn-3', text: 'Three' }),
        message({ id: 'm4', turnId: null, text: 'Four' }),
      ],
      approvals: {},
    });

    expect(items.map((item) => (item.kind === 'user' ? item.text : item.kind))).toEqual([
      'One',
      'assistant',
      'Two',
      'assistant',
      'Three',
      'Four',
    ]);
  });

  it('keeps reasoning separate from assistant text', () => {
    const items = groupTimeline({
      events: [
        event(1, { type: 'reasoning.delta', turnId: 'turn-1', text: 'Consider ' }),
        event(2, { type: 'reasoning.delta', turnId: 'turn-1', text: 'options' }),
        event(3, { type: 'text.delta', turnId: 'turn-1', text: 'Answer' }),
        event(4, { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' }),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => item.kind)).toEqual(['reasoning', 'assistant']);
    const reasoning = items[0];
    if (reasoning?.kind !== 'reasoning') throw new Error('Expected a reasoning row.');
    expect(reasoning.text).toBe('Consider options');
    expect(reasoning.streaming).toBe(false);
  });

  it('renders error events as notices and ignores bookkeeping events', () => {
    const items = groupTimeline({
      events: [
        event(1, {
          type: 'session.started',
          sessionId: 'session-1',
          model: 'test',
          capabilities: { tools: true, approvals: true, resume: false },
        }),
        event(2, { type: 'usage', turnId: 'turn-1', inputTokens: 10, outputTokens: 5 }),
        event(3, { type: 'error', message: 'Provider failed', retryable: true }),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('notice');
    if (items[0]?.kind !== 'notice') throw new Error('Expected a notice row.');
    expect(items[0].tone).toBe('error');
    expect(items[0].text).toBe('Provider failed');
  });
});

function toolEvents(turnId: string, startSeq: number, calls: { id: string; name: string }[]) {
  return calls.flatMap((call, index) => [
    event(startSeq + index * 2, {
      type: 'tool.started' as const,
      turnId,
      toolCallId: call.id,
      name: call.name,
      input: { command: `${call.name} --run` },
    }),
    event(startSeq + index * 2 + 1, {
      type: 'tool.finished' as const,
      turnId,
      toolCallId: call.id,
      output: `${call.name} ok`,
      isError: false,
    }),
  ]);
}

describe('tool grouping', () => {
  it('folds four consecutive tool calls into one summary row', () => {
    const items = groupTimeline({
      events: toolEvents('turn-1', 1, [
        { id: 'c1', name: 'read' },
        { id: 'c2', name: 'bash' },
        { id: 'c3', name: 'write' },
        { id: 'c4', name: 'edit' },
      ]),
      userMessages: [],
      approvals: {},
    });

    expect(items).toHaveLength(1);
    const group = items[0];
    if (group?.kind !== 'tool-group') throw new Error('Expected a tool group.');
    expect(group.tools.map((tool) => tool.name)).toEqual(['read', 'bash', 'write', 'edit']);
    expect(group.tools.every((tool) => !tool.running)).toBe(true);
    expect(toolGroupSummary(group.tools.length)).toBe('Ran 4 tools');
  });

  it('keeps a lone tool call as its own row', () => {
    const items = groupTimeline({
      events: toolEvents('turn-1', 1, [{ id: 'c1', name: 'bash' }]),
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => item.kind)).toEqual(['tool']);
  });

  it('breaks a run at assistant text so only adjacent calls group', () => {
    const items = groupTimeline({
      events: [
        ...toolEvents('turn-1', 1, [
          { id: 'c1', name: 'read' },
          { id: 'c2', name: 'bash' },
        ]),
        event(5, { type: 'text.delta', turnId: 'turn-1', text: 'Done.' }),
        ...toolEvents('turn-1', 6, [
          { id: 'c3', name: 'grep' },
          { id: 'c4', name: 'bash' },
        ]),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => item.kind)).toEqual(['tool-group', 'assistant', 'tool-group']);
  });

  it('does not fold across a notice or approval row', () => {
    const items: TimelineItem[] = [
      {
        kind: 'tool',
        key: 'tool-a',
        turnId: 'turn-1',
        toolCallId: 'a',
        name: 'bash',
        input: {},
        output: '',
        isError: false,
        running: false,
      },
      {
        kind: 'notice',
        key: 'notice-1',
        tone: 'info',
        text: 'Session ended: complete',
      },
      {
        kind: 'tool',
        key: 'tool-b',
        turnId: 'turn-1',
        toolCallId: 'b',
        name: 'bash',
        input: {},
        output: '',
        isError: false,
        running: false,
      },
    ];

    expect(collapseToolRuns(items).map((item) => item.kind)).toEqual(['tool', 'notice', 'tool']);
  });
});

describe('toolInputText', () => {
  it('renders a shell command raw instead of escaped JSON', () => {
    expect(toolInputText({ command: 'git rm src/legacy.ts && git commit -m "drop legacy"' })).toBe(
      'git rm src/legacy.ts && git commit -m "drop legacy"',
    );
    expect(toolInputText('echo hello')).toBe('echo hello');
  });

  it('falls back to pretty JSON for tools without a command', () => {
    expect(toolInputText({ path: 'src/index.ts' })).toBe('{\n  "path": "src/index.ts"\n}');
    expect(toolInputText(undefined)).toBe('');
  });
});

describe('toolSummary', () => {
  it('prefers known keys and collapses whitespace', () => {
    expect(toolSummary({ file_path: '/tmp/a b.ts' })).toBe('/tmp/a b.ts');
    expect(toolSummary({ other: 'fallback value' })).toBe('fallback value');
    expect(toolSummary('plain string')).toBe('plain string');
    expect(toolSummary(null)).toBe('');
  });

  it('truncates long values', () => {
    const summary = toolSummary({ command: 'a'.repeat(200) });
    expect(summary.length).toBe(80);
    expect(summary.endsWith('...')).toBe(true);
  });
});
