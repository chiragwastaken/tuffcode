import type { AdapterEvent } from '@tuffcode/contracts';

/**
 * Correlation state carried across one turn while mapping Claude Agent SDK
 * messages. It stays intentionally small: the turn id for every emitted event,
 * the current SDK session id (used for resume), and the tool calls that have
 * started but not yet produced a result.
 */
export interface ClaudeMappingState {
  turnId: string;
  sessionId: string | null;
  toolCallIds: Set<string>;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Translate one recorded Claude Agent SDK message into normalized adapter
 * events. Pure: the only mutation is the correlation state passed by the
 * caller. Unknown message types map to an empty list so newer SDK frames are
 * ignored instead of crashing the turn.
 */
export function mapSdkMessage(message: unknown, state: ClaudeMappingState): AdapterEvent[] {
  const record = asRecord(message);
  if (!record) return [];

  const sessionId = readString(record.session_id);
  if (sessionId) state.sessionId = sessionId;

  switch (record.type) {
    case 'system':
      return mapSystem(record, state);
    case 'assistant':
      return mapAssistant(record, state);
    case 'user':
      return mapUser(record, state);
    case 'result':
      return mapResult(record, state);
    default:
      return [];
  }
}

function mapSystem(record: JsonRecord, state: ClaudeMappingState): AdapterEvent[] {
  if (record.subtype === 'init') {
    if (!state.sessionId) return [];
    return [
      {
        type: 'session.started',
        sessionId: state.sessionId,
        model: readString(record.model) ?? '',
        capabilities: { tools: true, approvals: true, resume: true },
      },
    ];
  }
  if (record.subtype === 'worker_shutting_down') {
    return [{ type: 'session.ended', reason: readString(record.reason) ?? 'shutdown' }];
  }
  return [];
}

function mapAssistant(record: JsonRecord, state: ClaudeMappingState): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  const message = asRecord(record.message);
  const content = message?.content;

  if (Array.isArray(content)) {
    for (const block of content) {
      const item = asRecord(block);
      if (!item) continue;

      if (item.type === 'text') {
        const text = readString(item.text);
        if (text) events.push({ type: 'text.delta', turnId: state.turnId, text });
      } else if (item.type === 'thinking') {
        const text = readString(item.thinking);
        if (text) events.push({ type: 'reasoning.delta', turnId: state.turnId, text });
      } else if (item.type === 'tool_use') {
        const toolCallId = readString(item.id);
        const name = readString(item.name);
        if (!toolCallId || !name) continue;
        state.toolCallIds.add(toolCallId);
        events.push({
          type: 'tool.started',
          turnId: state.turnId,
          toolCallId,
          name,
          input: item.input ?? {},
        });
      }
    }
  }

  const error = readString(record.error);
  if (error) {
    const retryable = error === 'rate_limit' || error === 'overloaded' || error === 'server_error';
    events.push({ type: 'error', message: `claude: ${error}`, retryable });
  }
  return events;
}

function mapUser(record: JsonRecord, state: ClaudeMappingState): AdapterEvent[] {
  const message = asRecord(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];

  const events: AdapterEvent[] = [];
  for (const block of content) {
    const item = asRecord(block);
    if (!item || item.type !== 'tool_result') continue;

    const toolCallId = readString(item.tool_use_id);
    if (!toolCallId || !state.toolCallIds.has(toolCallId)) continue;
    state.toolCallIds.delete(toolCallId);

    events.push({
      type: 'tool.finished',
      turnId: state.turnId,
      toolCallId,
      output: toolResultText(item.content),
      isError: item.is_error === true,
    });
  }
  return events;
}

function mapResult(record: JsonRecord, state: ClaudeMappingState): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  const usage = asRecord(record.usage);

  if (usage) {
    const inputTokens = readNumber(usage.input_tokens);
    const outputTokens = readNumber(usage.output_tokens);
    const costUsd = readNumber(record.total_cost_usd);
    events.push({
      type: 'usage',
      turnId: state.turnId,
      ...(inputTokens !== null ? { inputTokens } : {}),
      ...(outputTokens !== null ? { outputTokens } : {}),
      ...(costUsd !== null ? { costUsd } : {}),
    });
  }

  if (record.is_error === true || record.subtype !== 'success') {
    const errors = Array.isArray(record.errors)
      ? record.errors.filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        )
      : [];
    const detail =
      errors.length > 0
        ? errors.join('; ')
        : (readString(record.result) ?? readString(record.subtype) ?? 'unknown error');
    events.push({ type: 'error', message: `claude: ${detail}`, retryable: false });
  }

  return events;
}

function toolResultText(content: unknown): string {
  const text = readString(content);
  if (text !== null) return text;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    const item = asRecord(block);
    if (!item) continue;
    if (item.type === 'text') {
      const value = readString(item.text);
      if (value) parts.push(value);
    } else if (item.type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n');
}
