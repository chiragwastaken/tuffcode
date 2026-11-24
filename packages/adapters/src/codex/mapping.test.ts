import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AdapterEvent, PermissionMode } from '@tuffcode/contracts';
import { parseRpcMessage } from './jsonrpc.js';
import {
  codexToolName,
  createTurnState,
  isApprovalMethod,
  mapApprovalRequest,
  mapCodexMessage,
  mapNotification,
  mapTurnStatus,
  mapUsage,
  type CodexTurnState,
} from './mapping.js';

const CONTRACT_TURN = 'turn-contract-1';

function replay(fixture: string, mode: PermissionMode = 'ask') {
  const path = new URL(`../fixtures/codex/${fixture}`, import.meta.url);
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const state = createTurnState(CONTRACT_TURN);
  const events: AdapterEvent[] = [];

  for (const line of lines) {
    const message = parseRpcMessage(line);
    expect(message, `fixture line should parse: ${line}`).not.toBeNull();
    if (message === null) continue;
    events.push(...mapCodexMessage(message, state, mode));
  }

  return { events, state };
}

function types(events: AdapterEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('recorded fixture replay', () => {
  it('maps an assistant text turn', () => {
    const { events, state } = replay('turn-text.jsonl');

    expect(types(events)).toEqual(['text.delta', 'text.delta', 'turn.finished']);
    expect(events[0]).toEqual({ type: 'text.delta', turnId: CONTRACT_TURN, text: 'Hello' });
    expect(events[1]).toEqual({ type: 'text.delta', turnId: CONTRACT_TURN, text: ' from Codex' });
    expect(events[2]).toEqual({ type: 'turn.finished', turnId: CONTRACT_TURN, reason: 'complete' });
    expect(state.codexTurnId).toBe('turn_0199a1');
    expect(state.threadId).toBe('th_0199a1');
    expect(state.finished).toBe(true);
  });

  it('maps a tool turn with reasoning and usage', () => {
    const { events } = replay('turn-tool.jsonl');

    expect(types(events)).toEqual([
      'tool.started',
      'tool.delta',
      'tool.finished',
      'reasoning.delta',
      'text.delta',
      'usage',
      'turn.finished',
    ]);
    expect(events[0]).toMatchObject({
      type: 'tool.started',
      turnId: CONTRACT_TURN,
      toolCallId: 'call_7',
      name: 'command',
    });
    expect(events[2]).toMatchObject({
      type: 'tool.finished',
      toolCallId: 'call_7',
      output: 'PASS demo.test.ts\n',
      isError: false,
    });
    expect(events[3]).toEqual({
      type: 'reasoning.delta',
      turnId: CONTRACT_TURN,
      text: 'Checking the test output',
    });
    expect(events[5]).toEqual({
      type: 'usage',
      turnId: CONTRACT_TURN,
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('maps an approval request and an interrupted completion', () => {
    const { events } = replay('approval-command.jsonl');

    expect(types(events)).toEqual(['approval.requested', 'turn.finished']);
    expect(events[0]).toMatchObject({
      type: 'approval.requested',
      turnId: CONTRACT_TURN,
      approvalId: 'ap_0199a3',
      toolCallId: 'call_9',
      name: 'command',
      input: { command: 'curl https://example.com/health' },
    });
    expect(events[1]).toEqual({ type: 'turn.finished', turnId: CONTRACT_TURN, reason: 'interrupted' });
  });

  it('maps an error notification without duplicating it on completion', () => {
    const { events } = replay('turn-error.jsonl');

    expect(types(events)).toEqual(['error', 'turn.finished']);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'codex: rate limit reached',
      retryable: false,
    });
    expect(events[1]).toEqual({ type: 'turn.finished', turnId: CONTRACT_TURN, reason: 'error' });
  });

  it('auto-answers file changes in accept-edits mode', () => {
    const params = {
      threadId: 'th_1',
      turnId: 'turn_1',
      itemId: 'patch_1',
      startedAtMs: 1,
    };
    const mapping = mapApprovalRequest('item/fileChange/requestApproval', params, 'accept-edits', CONTRACT_TURN);

    expect(mapping?.autoDecision).toBe('accept');
    expect(mapping?.event).toBeNull();
  });

  it('auto-answers every approval in full-auto mode', () => {
    const mapping = mapApprovalRequest(
      'item/commandExecution/requestApproval',
      { itemId: 'call_1', command: 'npm test' },
      'full-auto',
      CONTRACT_TURN,
    );

    expect(mapping?.autoDecision).toBe('accept');
    expect(mapping?.event).toBeNull();
  });
});

describe('notification mapping', () => {
  it('ignores notifications for another turn or thread', () => {
    const state = createTurnState(CONTRACT_TURN);
    state.codexTurnId = 'turn_ours';
    state.threadId = 'th_ours';

    expect(
      mapNotification('item/agentMessage/delta', { turnId: 'turn_other', delta: 'x' }, state),
    ).toEqual([]);
    expect(
      mapNotification(
        'item/agentMessage/delta',
        { threadId: 'th_other', turnId: 'turn_ours', delta: 'x' },
        state,
      ),
    ).toEqual([]);
    expect(state.codexTurnId).toBe('turn_ours');
  });

  it('ignores unknown notifications', () => {
    const state = createTurnState(CONTRACT_TURN);
    expect(mapNotification('thread/name/updated', { threadId: 'th_1', name: 'x' }, state)).toEqual([]);
  });

  it('falls back to the completed agent message when no deltas arrived', () => {
    const state = createTurnState(CONTRACT_TURN);
    const events = mapNotification(
      'item/completed',
      {
        threadId: 'th_1',
        turnId: 'turn_1',
        item: { type: 'agentMessage', id: 'msg_1', text: 'final answer' },
      },
      state,
    );

    expect(events).toEqual([{ type: 'text.delta', turnId: CONTRACT_TURN, text: 'final answer' }]);
  });

  it('does not repeat text already streamed as deltas', () => {
    const state = createTurnState(CONTRACT_TURN);
    mapNotification(
      'item/agentMessage/delta',
      { turnId: 'turn_1', itemId: 'msg_1', delta: 'final answer' },
      state,
    );

    expect(
      mapNotification(
        'item/completed',
        { turnId: 'turn_1', item: { type: 'agentMessage', id: 'msg_1', text: 'final answer' } },
        state,
      ),
    ).toEqual([]);
  });

  it('flags a non-zero exit code as a tool error', () => {
    const state = createTurnState(CONTRACT_TURN);
    const events = mapNotification(
      'item/completed',
      {
        turnId: 'turn_1',
        item: {
          type: 'commandExecution',
          id: 'call_2',
          status: 'completed',
          aggregatedOutput: 'boom',
          exitCode: 2,
        },
      },
      state,
    );

    expect(events).toEqual([
      { type: 'tool.finished', turnId: CONTRACT_TURN, toolCallId: 'call_2', output: 'boom', isError: true },
    ]);
  });

  it('maps retryable errors from the error notification', () => {
    const state = createTurnState(CONTRACT_TURN);
    const events = mapNotification(
      'error',
      { turnId: 'turn_1', willRetry: true, error: { message: 'overloaded' } },
      state,
    );

    expect(events).toEqual([{ type: 'error', message: 'codex: overloaded', retryable: true }]);
  });
});

describe('pure helpers', () => {
  it('maps terminal turn statuses', () => {
    expect(mapTurnStatus('completed')).toBe('complete');
    expect(mapTurnStatus('interrupted')).toBe('interrupted');
    expect(mapTurnStatus('failed')).toBe('error');
    expect(mapTurnStatus('inProgress')).toBe('error');
    expect(mapTurnStatus(null)).toBe('error');
  });

  it('maps usage from the last breakdown', () => {
    const state = createTurnState(CONTRACT_TURN);
    const events = mapUsage(
      {
        turnId: 'turn_1',
        tokenUsage: {
          total: { inputTokens: 999, outputTokens: 999 },
          last: { inputTokens: 10, outputTokens: 4 },
        },
      },
      state,
    );

    expect(events).toEqual([{ type: 'usage', turnId: CONTRACT_TURN, inputTokens: 10, outputTokens: 4 }]);
  });

  it('omits usage when the payload has no counts', () => {
    const state = createTurnState(CONTRACT_TURN);
    expect(mapUsage({ turnId: 'turn_1', tokenUsage: {} }, state)).toEqual([]);
  });

  it('recognizes v2 and legacy approval methods', () => {
    expect(isApprovalMethod('item/commandExecution/requestApproval')).toBe(true);
    expect(isApprovalMethod('item/fileChange/requestApproval')).toBe(true);
    expect(isApprovalMethod('execCommandApproval')).toBe(true);
    expect(isApprovalMethod('applyPatchApproval')).toBe(true);
    expect(isApprovalMethod('mcpServer/elicitation/request')).toBe(false);
  });

  it('uses the legacy call_id for approval correlation', () => {
    const mapping = mapApprovalRequest(
      'execCommandApproval',
      { conversation_id: 'th_1', call_id: 'call_legacy', command: ['npm', 'test'] },
      'ask',
      CONTRACT_TURN,
    );

    expect(mapping).toMatchObject({ approvalId: 'call_legacy', toolCallId: 'call_legacy', name: 'command' });
  });

  it('names tools from the item payload', () => {
    expect(codexToolName({ type: 'commandExecution' })).toBe('command');
    expect(codexToolName({ type: 'fileChange' })).toBe('apply_patch');
    expect(codexToolName({ type: 'mcpToolCall', server: 'fs', tool: 'read' })).toBe('fs.read');
    expect(codexToolName({ type: 'webSearch' })).toBe('web_search');
  });

  it('keeps the contract turn id in every event', () => {
    const state: CodexTurnState = createTurnState(CONTRACT_TURN);
    const events = [
      ...mapNotification('item/agentMessage/delta', { turnId: 't1', delta: 'a' }, state),
      ...mapNotification('item/reasoning/textDelta', { turnId: 't1', delta: 'b' }, state),
      ...mapNotification(
        'item/completed',
        { turnId: 't1', item: { type: 'commandExecution', id: 'c1', status: 'completed', exitCode: 0 } },
        state,
      ),
    ];

    for (const event of events) {
      expect(event).toHaveProperty('turnId', CONTRACT_TURN);
    }
  });
});
