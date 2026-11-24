import type { ApprovalChoice, Attachment, Message, ThreadEventRow } from '@tuffcode/contracts';

export type LocalMessageStatus = 'pending' | 'sent' | 'failed';

export interface LocalUserMessage {
  id: string;
  threadId: string;
  turnId: string | null;
  text: string;
  attachments: Attachment[];
  status: LocalMessageStatus;
  createdAt: string;
}

export type ApprovalDecisionMap = Readonly<Record<string, ApprovalChoice>>;

export interface UserItem {
  kind: 'user';
  key: string;
  messageId: string;
  text: string;
  attachments: Attachment[];
  status: LocalMessageStatus;
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

/** Consecutive tool calls folded under one expandable summary row. */
export interface ToolGroupItem {
  kind: 'tool-group';
  key: string;
  turnId: string;
  tools: ToolItem[];
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
  | ToolGroupItem
  | ApprovalItem
  | NoticeItem;

export interface GroupTimelineInput {
  events: readonly ThreadEventRow[];
  /** Rows from `messages.list`; they fill gaps the event replay does not cover. */
  messages?: readonly Message[];
  userMessages: readonly LocalUserMessage[];
  approvals: ApprovalDecisionMap;
}

interface TurnState {
  usersPlaced: boolean;
  assistant: AssistantItem | null;
  reasoning: ReasoningItem | null;
  tools: Map<string, ToolItem>;
  /** The assistant text came from the persisted row, so later deltas are stale. */
  assistantFinal: boolean;
}

/** The server derives message ids from the turn, so a row identifies its turn. */
const PERSISTED_MESSAGE_ID = /^msg_(.+)_(user|assistant)$/;

function turnIdForMessage(message: Message): string | null {
  const match = PERSISTED_MESSAGE_ID.exec(message.id);
  if (match === null || match[2] !== message.role) return null;
  return match[1] ?? null;
}

/** Turn ids that already have a persisted row, used to prune resolved echoes. */
export function persistedTurnIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const turnId = turnIdForMessage(message);
    if (turnId !== null) ids.add(turnId);
  }
  return ids;
}

/**
 * The echo and its persisted row are written during one request, so they land
 * within seconds. A tight window keeps two identical sends from merging.
 */
const ECHO_MATCH_WINDOW_MS = 5_000;

function sameEchoText(echo: LocalUserMessage, row: LocalUserMessage): boolean {
  if (echo.text.trim() !== row.text.trim()) return false;
  const echoTime = Date.parse(echo.createdAt);
  const rowTime = Date.parse(row.createdAt);
  if (Number.isNaN(echoTime) || Number.isNaN(rowTime)) return false;
  return Math.abs(echoTime - rowTime) <= ECHO_MATCH_WINDOW_MS;
}

function persistedUserMessage(message: Message): LocalUserMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    turnId: turnIdForMessage(message),
    text: message.content,
    attachments: [],
    status: 'sent',
    createdAt: message.createdAt,
  };
}

/**
 * A persisted row is the canonical copy of a sent message; the session-local echo
 * only survives while no row exists, and it keeps its attachments either way.
 * Turn ids claim their row first so a text match cannot steal it.
 */
function mergeUserMessages(
  persisted: LocalUserMessage[],
  echoes: readonly LocalUserMessage[],
): LocalUserMessage[] {
  const merged = persisted.slice();
  const claimed = new Set<string>();
  const loose: LocalUserMessage[] = [];

  for (const echo of echoes) {
    if (echo.turnId === null) {
      loose.push(echo);
      continue;
    }
    const match = merged.find((row) => !claimed.has(row.id) && row.turnId === echo.turnId);
    if (match === undefined) {
      merged.push(echo);
      continue;
    }
    claimed.add(match.id);
    if (echo.attachments.length > 0) match.attachments = echo.attachments;
  }

  for (const echo of loose) {
    const match = merged.find((row) => !claimed.has(row.id) && sameEchoText(echo, row));
    if (match === undefined) {
      merged.push(echo);
      continue;
    }
    claimed.add(match.id);
    if (echo.attachments.length > 0) match.attachments = echo.attachments;
  }

  return merged;
}

function userItem(message: LocalUserMessage): UserItem {
  return {
    kind: 'user',
    key: `user-${message.id}`,
    messageId: message.id,
    text: message.text,
    attachments: message.attachments,
    status: message.status,
  };
}

/** A user row belongs before an event with the same timestamp; an assistant row after. */
function beforeEvent(message: Message, event: ThreadEventRow): boolean {
  if (message.createdAt === event.createdAt) return message.role === 'user';
  return message.createdAt < event.createdAt;
}

/**
 * Folds the per-thread event log into render rows. Persisted message rows are
 * interleaved by `createdAt`, so a reopened thread keeps its user turns and any
 * assistant text the replay does not cover. One assistant row per turn accumulates
 * text deltas; the persisted row replaces that text instead of adding a second row.
 */
export function groupTimeline({
  events,
  messages = [],
  userMessages,
  approvals,
}: GroupTimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  const turns = new Map<string, TurnState>();
  const usersByTurn = new Map<string, LocalUserMessage[]>();
  const pending: LocalUserMessage[] = [];

  const persistedUsers = messages
    .filter((message) => message.role === 'user')
    .map(persistedUserMessage);
  const users = mergeUserMessages(persistedUsers, userMessages);

  for (const message of users) {
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
      state = {
        usersPlaced: false,
        assistant: null,
        reasoning: null,
        tools: new Map(),
        assistantFinal: false,
      };
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

  function placePersistedUser(message: Message): void {
    const turnId = turnIdForMessage(message);
    if (turnId === null) {
      items.push(userItem(persistedUserMessage(message)));
      return;
    }
    placeUsers(turnId);
  }

  function placePersistedAssistant(message: Message): void {
    const turnId = turnIdForMessage(message);
    if (turnId === null) {
      items.push({
        kind: 'assistant',
        key: `assistant-${message.id}`,
        turnId: message.id,
        text: message.content,
        streaming: false,
      });
      return;
    }
    const state = turnState(turnId);
    if (state.assistant) {
      state.assistant.text = message.content;
      state.assistant.streaming = false;
      state.assistantFinal = true;
      return;
    }
    state.assistant = {
      kind: 'assistant',
      key: `assistant-${turnId}`,
      turnId,
      text: message.content,
      streaming: false,
    };
    state.assistantFinal = true;
    items.push(state.assistant);
  }

  const persisted = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .toSorted((left, right) => {
      if (left.createdAt === right.createdAt) return left.id.localeCompare(right.id);
      return left.createdAt < right.createdAt ? -1 : 1;
    });

  const entries: (Message | ThreadEventRow)[] = [];
  let nextMessage = 0;
  for (const event of events) {
    while (nextMessage < persisted.length) {
      const message = persisted[nextMessage];
      if (message === undefined || !beforeEvent(message, event)) break;
      entries.push(message);
      nextMessage += 1;
    }
    entries.push(event);
  }
  while (nextMessage < persisted.length) {
    const message = persisted[nextMessage];
    if (message !== undefined) entries.push(message);
    nextMessage += 1;
  }

  for (const entry of entries) {
    if ('role' in entry) {
      if (entry.role === 'user') placePersistedUser(entry);
      else if (entry.role === 'assistant') placePersistedAssistant(entry);
      continue;
    }

    const event = entry;
    const payload = event.payload;
    if ('turnId' in payload) placeUsers(payload.turnId);

    switch (payload.type) {
      case 'text.delta': {
        if (payload.text.length === 0) break;
        const state = turnState(payload.turnId);
        if (state.assistantFinal) break;
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

  return collapseToolRuns(items);
}

/** Two or more consecutive tool calls read better as one summary row. */
const TOOL_GROUP_MIN = 2;

/** Folds runs of consecutive tool rows into expandable summary rows. */
export function collapseToolRuns(items: readonly TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let run: ToolItem[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    const [first] = run;
    if (first && run.length >= TOOL_GROUP_MIN) {
      result.push({
        kind: 'tool-group',
        key: `tools-${first.key}`,
        turnId: first.turnId,
        tools: run,
      });
    } else {
      result.push(...run);
    }
    run = [];
  };

  for (const item of items) {
    if (item.kind === 'tool') {
      run.push(item);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();

  return result;
}

/** "Ran 4 tools" for a collapsed group; the count is always plural here. */
export function toolGroupSummary(count: number): string {
  return `Ran ${count} tools`;
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

const COMMAND_KEYS = ['command', 'cmd', 'script', 'shell'] as const;

/**
 * The human-readable body of a tool call: a shell command stays raw instead of
 * arriving as escaped JSON, and anything else falls back to pretty JSON.
 */
export function toolInputText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input !== null && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of COMMAND_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) return value;
    }
  }
  return formatToolInput(input);
}
