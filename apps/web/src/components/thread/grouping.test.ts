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
import { groupTurnBlocks } from './turn-blocks';

function event(
  seq: number,
  payload: AdapterEvent,
  createdAt = '2026-01-01T00:00:00.000Z',
): ThreadEventRow {
  return {
    id: seq + 1,
    threadId: 'thread-1',
    seq,
    type: payload.type,
    payload,
    createdAt,
  };
}

function message(overrides: Partial<LocalUserMessage> = {}): LocalUserMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    text: 'Do the thing',
    attachments: [],
    status: 'sent',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function persisted(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string,
  threadId = 'thread-1',
) {
  return { id, threadId, role, content, createdAt } as const;
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

  it('opens a new reasoning and assistant segment after every tool call', () => {
    const items = groupTimeline({
      events: [
        event(1, { type: 'reasoning.delta', turnId: 'turn-1', text: 'A' }, '2026-01-01T00:00:01.000Z'),
        event(2, { type: 'text.delta', turnId: 'turn-1', text: 'P1' }, '2026-01-01T00:00:02.000Z'),
        event(
          3,
          { type: 'tool.started', turnId: 'turn-1', toolCallId: 'c1', name: 'read', input: {} },
          '2026-01-01T00:00:03.000Z',
        ),
        event(
          4,
          { type: 'tool.finished', turnId: 'turn-1', toolCallId: 'c1', output: 'ok', isError: false },
          '2026-01-01T00:00:04.000Z',
        ),
        event(5, { type: 'reasoning.delta', turnId: 'turn-1', text: 'B' }, '2026-01-01T00:00:05.000Z'),
        event(6, { type: 'text.delta', turnId: 'turn-1', text: 'P2' }, '2026-01-01T00:00:06.000Z'),
        event(
          7,
          { type: 'tool.started', turnId: 'turn-1', toolCallId: 'c2', name: 'grep', input: {} },
          '2026-01-01T00:00:07.000Z',
        ),
        event(
          8,
          { type: 'tool.finished', turnId: 'turn-1', toolCallId: 'c2', output: 'ok', isError: false },
          '2026-01-01T00:00:08.000Z',
        ),
        event(9, { type: 'text.delta', turnId: 'turn-1', text: 'ANSWER' }, '2026-01-01T00:00:09.000Z'),
        event(10, { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' }, '2026-01-01T00:00:09.000Z'),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => (item.kind === 'assistant' ? item.text : item.kind))).toEqual([
      'reasoning',
      'P1',
      'tool',
      'reasoning',
      'P2',
      'tool',
      'ANSWER',
    ]);
    const reasoningTexts = items.flatMap((item) => (item.kind === 'reasoning' ? item.text : []));
    expect(reasoningTexts).toEqual(['A', 'B']);

    const blocks = groupTurnBlocks(items);
    expect(blocks.map((block) => block.kind)).toEqual([
      'reasoning',
      'prose',
      'tools',
      'reasoning',
      'prose',
      'tools',
      'final',
    ]);
    const finals = blocks.filter((block) => block.kind === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]?.kind === 'final' ? finals[0].text : null).toBe('ANSWER');
    const proseTexts = blocks.flatMap((block) => (block.kind === 'prose' ? [block.text] : []));
    expect(proseTexts).toEqual(['P1', 'P2']);
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

describe('persisted messages', () => {
  it('merges rows and events in createdAt order across turns', () => {
    const items = groupTimeline({
      events: [
        event(1, { type: 'turn.started', turnId: 'turn-1' }, '2026-01-01T00:00:02.000Z'),
        event(
          2,
          { type: 'text.delta', turnId: 'turn-1', text: 'First answer' },
          '2026-01-01T00:00:03.000Z',
        ),
        event(
          3,
          { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' },
          '2026-01-01T00:00:04.000Z',
        ),
        event(
          4,
          { type: 'text.delta', turnId: 'turn-2', text: 'Second answer' },
          '2026-01-01T00:00:12.000Z',
        ),
      ],
      messages: [
        persisted('msg_turn-1_user', 'user', 'First question', '2026-01-01T00:00:01.000Z'),
        persisted('msg_turn-1_assistant', 'assistant', 'First answer', '2026-01-01T00:00:04.000Z'),
        persisted('msg_turn-2_user', 'user', 'Second question', '2026-01-01T00:00:11.000Z'),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => (item.kind === 'user' ? item.text : item.kind))).toEqual([
      'First question',
      'assistant',
      'Second question',
      'assistant',
    ]);
    const firstAssistant = items[1];
    if (firstAssistant?.kind !== 'assistant') throw new Error('Expected an assistant row.');
    expect(firstAssistant.text).toBe('First answer');
  });

  it('renders user and assistant rows when the event replay has no turn events', () => {
    const items = groupTimeline({
      events: [],
      messages: [
        persisted('msg_turn-1_user', 'user', 'Question', '2026-01-01T00:00:01.000Z'),
        persisted('msg_turn-1_assistant', 'assistant', 'Answer', '2026-01-01T00:00:02.000Z'),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => item.kind)).toEqual(['user', 'assistant']);
    const assistant = items[1];
    if (assistant?.kind !== 'assistant') throw new Error('Expected an assistant row.');
    expect(assistant.text).toBe('Answer');
    expect(assistant.streaming).toBe(false);
  });

  it('replaces streamed text with the persisted row instead of duplicating it', () => {
    const items = groupTimeline({
      events: [
        event(1, { type: 'text.delta', turnId: 'turn-1', text: 'Hel' }),
        event(2, { type: 'text.delta', turnId: 'turn-1', text: 'lo' }),
        event(3, { type: 'turn.finished', turnId: 'turn-1', reason: 'complete' }),
      ],
      messages: [
        persisted('msg_turn-1_assistant', 'assistant', 'Hello', '2026-01-01T00:00:00.000Z'),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items).toHaveLength(1);
    const assistant = items[0];
    if (assistant?.kind !== 'assistant') throw new Error('Expected an assistant row.');
    expect(assistant.text).toBe('Hello');
    expect(assistant.streaming).toBe(false);
  });

  it('drops the local echo once the persisted row for its turn arrives', () => {
    const items = groupTimeline({
      events: [event(1, { type: 'turn.started', turnId: 'turn-1' }, '2026-01-01T00:00:02.000Z')],
      messages: [persisted('msg_turn-1_user', 'user', 'Do the thing', '2026-01-01T00:00:01.000Z')],
      userMessages: [
        message({
          turnId: 'turn-1',
          text: 'Do the thing',
          status: 'sent',
          createdAt: '2026-01-01T00:00:01.500Z',
          attachments: [{ name: 'notes.md', path: 'notes.md' }],
        }),
      ],
      approvals: {},
    });

    const users = items.filter((item) => item.kind === 'user');
    expect(users).toHaveLength(1);
    expect(users[0]?.attachments).toHaveLength(1);
    expect(users[0]?.status).toBe('sent');
  });

  it('matches an echo without a turn id by text and timestamp window', () => {
    const items = groupTimeline({
      events: [],
      messages: [persisted('msg_turn-1_user', 'user', 'Do the thing', '2026-01-01T00:00:01.000Z')],
      userMessages: [
        message({
          id: 'echo-1',
          turnId: null,
          text: 'Do the thing',
          status: 'pending',
          createdAt: '2026-01-01T00:00:05.000Z',
        }),
      ],
      approvals: {},
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('user');
  });

  it('claims the persisted row for a failed send that already persisted', () => {
    const items = groupTimeline({
      events: [],
      messages: [persisted('msg_turn-1_user', 'user', 'Do the thing', '2026-01-01T00:00:01.000Z')],
      userMessages: [
        message({
          id: 'echo-1',
          turnId: null,
          text: 'Do the thing',
          status: 'failed',
          createdAt: '2026-01-01T00:00:01.100Z',
        }),
      ],
      approvals: {},
    });

    expect(items).toHaveLength(1);
    const [row] = items;
    if (row?.kind !== 'user') throw new Error('Expected a user row.');
    expect(row.status).toBe('sent');
  });

  it('does not let a failed echo steal the row of a later retry', () => {
    const items = groupTimeline({
      events: [],
      messages: [persisted('msg_turn-2_user', 'user', 'Retry me', '2026-01-01T00:00:05.000Z')],
      userMessages: [
        message({
          id: 'echo-failed',
          turnId: null,
          text: 'Retry me',
          status: 'failed',
          createdAt: '2026-01-01T00:00:01.000Z',
        }),
        message({
          id: 'echo-retry',
          turnId: 'turn-2',
          text: 'Retry me',
          status: 'sent',
          createdAt: '2026-01-01T00:00:05.000Z',
        }),
      ],
      approvals: {},
    });

    const users = items.filter((item) => item.kind === 'user');
    expect(users).toHaveLength(2);
    expect(users[0]?.status).toBe('sent');
    expect(users[1]?.status).toBe('failed');
  });

  it('carries pending and failed send states into the user row', () => {
    const items = groupTimeline({
      events: [],
      messages: [],
      userMessages: [
        message({ id: 'echo-pending', turnId: null, status: 'pending', text: 'Waiting' }),
        message({ id: 'echo-failed', turnId: null, status: 'failed', text: 'Broken' }),
      ],
      approvals: {},
    });

    expect(items.map((item) => (item.kind === 'user' ? item.status : item.kind))).toEqual([
      'pending',
      'failed',
    ]);
  });

  it('interleaves a turn without events between turns that have them', () => {
    const items = groupTimeline({
      events: [
        event(
          1,
          { type: 'text.delta', turnId: 'turn-2', text: 'Live answer' },
          '2026-01-01T00:00:10.000Z',
        ),
      ],
      messages: [
        persisted('msg_turn-1_user', 'user', 'Old question', '2026-01-01T00:00:01.000Z'),
        persisted('msg_turn-1_assistant', 'assistant', 'Old answer', '2026-01-01T00:00:02.000Z'),
        persisted('msg_turn-2_user', 'user', 'Live question', '2026-01-01T00:00:09.000Z'),
      ],
      userMessages: [],
      approvals: {},
    });

    expect(items.map((item) => (item.kind === 'user' ? item.text : item.kind))).toEqual([
      'Old question',
      'assistant',
      'Live question',
      'assistant',
    ]);
    const oldAssistant = items[1];
    if (oldAssistant?.kind !== 'assistant') throw new Error('Expected an assistant row.');
    expect(oldAssistant.text).toBe('Old answer');
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
        startedAt: null,
        finishedAt: null,
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
        startedAt: null,
        finishedAt: null,
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
