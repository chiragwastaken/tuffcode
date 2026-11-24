import type { ApprovalChoice, Attachment, ThreadEventRow } from '@tuffcode/contracts';

export interface LocalUserMessage {
  id: string;
  threadId: string;
  turnId: string | null;
  text: string;
  attachments: Attachment[];
}

export type ApprovalDecisionMap = Readonly<Record<string, ApprovalChoice>>;

export interface UserItem {
  kind: 'user';
  key: string;
  text: string;
  attachments: Attachment[];
}

export interface AssistantItem {
  kind: 'assistant';
  key: string;
  turnId: string;
  text: string;
  streaming: boolean;
}

export interface ReasoningItem {
  kind: 'reasoning';
  key: string;
  turnId: string;
  text: string;
  streaming: boolean;
}

export interface ToolItem {
  kind: 'tool';
  key: string;
  turnId: string;
  toolCallId: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  running: boolean;
}

export interface ApprovalItem {
  kind: 'approval';
  key: string;
  turnId: string;
  approvalId: string;
  name: string;
  input: unknown;
  decision: ApprovalChoice | null;
}

export interface NoticeItem {
  kind: 'notice';
  key: string;
  tone: 'error' | 'info';
  text: string;
}

export type TimelineItem =
  | UserItem
  | AssistantItem
  | ReasoningItem
  | ToolItem
  | ApprovalItem
  | NoticeItem;

export interface GroupTimelineInput {
  events: readonly ThreadEventRow[];
  userMessages: readonly LocalUserMessage[];
  approvals: ApprovalDecisionMap;
}

interface TurnState {
  usersPlaced: boolean;
  assistant: AssistantItem | null;
  reasoning: ReasoningItem | null;
  tools: Map<string, ToolItem>;
}

function userItem(message: LocalUserMessage): UserItem {
  return {
    kind: 'user',
    key: `user-${message.id}`,
    text: message.text,
    attachments: message.attachments,
  };
}

/**
 * Folds the per-thread event log into render rows. One assistant row per turn
 * accumulates text deltas, tools are keyed by tool call id, and the local echo of
 * a sent user message is placed ahead of the first event that carries its turn id.
 */
export function groupTimeline({
  events,
  userMessages,
  approvals,
}: GroupTimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  const turns = new Map<string, TurnState>();
  const usersByTurn = new Map<string, LocalUserMessage[]>();
  const pending: LocalUserMessage[] = [];

  for (const message of userMessages) {
    if (message.turnId === null) {
      pending.push(message);
      continue;
    }
    const list = usersByTurn.get(message.turnId);
    if (list) list.push(message);
    else usersByTurn.set(message.turnId, [message]);
  }

  function turnState(turnId: string): TurnState {
    let state = turns.get(turnId);
    if (!state) {
      state = { usersPlaced: false, assistant: null, reasoning: null, tools: new Map() };
      turns.set(turnId, state);
    }
    return state;
  }

  function placeUsers(turnId: string): void {
    const state = turnState(turnId);
    if (state.usersPlaced) return;
    state.usersPlaced = true;
    for (const message of usersByTurn.get(turnId) ?? []) items.push(userItem(message));
  }

  for (const event of events) {
    const payload = event.payload;
    if ('turnId' in payload) placeUsers(payload.turnId);

    switch (payload.type) {
      case 'text.delta': {
        if (payload.text.length === 0) break;
        const state = turnState(payload.turnId);
        if (!state.assistant) {
          state.assistant = {
            kind: 'assistant',
            key: `assistant-${payload.turnId}`,
            turnId: payload.turnId,
            text: '',
            streaming: true,
          };
          items.push(state.assistant);
        }
        state.assistant.text += payload.text;
        break;
      }
      case 'reasoning.delta': {
        if (payload.text.length === 0) break;
        const state = turnState(payload.turnId);
        if (!state.reasoning) {
          state.reasoning = {
            kind: 'reasoning',
            key: `reasoning-${payload.turnId}`,
            turnId: payload.turnId,
            text: '',
            streaming: true,
          };
          items.push(state.reasoning);
        }
        state.reasoning.text += payload.text;
        break;
      }
      case 'tool.started': {
        const state = turnState(payload.turnId);
        const item: ToolItem = {
          kind: 'tool',
          key: `tool-${payload.toolCallId}`,
          turnId: payload.turnId,
          toolCallId: payload.toolCallId,
          name: payload.name,
          input: payload.input,
          output: '',
          isError: false,
          running: true,
        };
        state.tools.set(payload.toolCallId, item);
        items.push(item);
        break;
      }
      case 'tool.delta': {
        const item = turnState(payload.turnId).tools.get(payload.toolCallId);
        if (item) item.output += payload.text;
        break;
      }
      case 'tool.finished': {
        const item = turnState(payload.turnId).tools.get(payload.toolCallId);
        if (item) {
          item.output = payload.output;
          item.isError = payload.isError;
          item.running = false;
        }
        break;
      }
      case 'approval.requested': {
        items.push({
          kind: 'approval',
          key: `approval-${payload.approvalId}`,
          turnId: payload.turnId,
          approvalId: payload.approvalId,
          name: payload.name,
          input: payload.input,
          decision: approvals[payload.approvalId] ?? null,
        });
        break;
      }
      case 'turn.finished': {
        const state = turns.get(payload.turnId);
        if (state?.assistant) state.assistant.streaming = false;
        if (state?.reasoning) state.reasoning.streaming = false;
        break;
      }
      case 'error': {
        items.push({
          kind: 'notice',
          key: `notice-${event.seq}`,
          tone: 'error',
          text: payload.message,
        });
        break;
      }
      case 'session.ended': {
        items.push({
          kind: 'notice',
          key: `notice-${event.seq}`,
          tone: 'info',
          text: `Session ended: ${payload.reason}`,
        });
        break;
      }
      default:
        break;
    }
  }

  for (const [turnId, list] of usersByTurn) {
    if (turns.get(turnId)?.usersPlaced) continue;
    for (const message of list) items.push(userItem(message));
  }
  for (const message of pending) items.push(userItem(message));

  return items;
}

const SUMMARY_KEYS = [
  'command',
  'path',
  'file_path',
  'filePath',
  'pattern',
  'url',
  'query',
  'description',
  'prompt',
] as const;

function oneLine(value: string, max = 80): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** A short single-line hint for a tool call, taken from its input. */
export function toolSummary(input: unknown): string {
  if (typeof input === 'string') return oneLine(input);
  if (input === null || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return oneLine(value);
  }
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim().length > 0) return oneLine(value);
  }
  return '';
}

export function formatToolInput(input: unknown): string {
  if (input === undefined) return '';
  try {
    return JSON.stringify(input, null, 2) ?? '';
  } catch {
    return String(input);
  }
}
