import type { AdapterEvent, PermissionMode } from '@tuffcode/contracts';
import { asRecord, readInteger, readString, type JsonRecord } from './guards.js';
import { CODEX_METHODS } from './protocol.js';
import type { RpcMessage } from './jsonrpc.js';

/** Turn completion reasons accepted by the normalized contract. */
export type TurnReason = 'complete' | 'interrupted' | 'error';

/** Decisions the app-server accepts for v2 approval requests. */
export type ApprovalWireDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

/**
 * Correlation state for one contract turn. The contract turn id is what every
 * emitted event carries; the codex ids are only used for follow-up requests.
 */
export interface CodexTurnState {
  turnId: string;
  codexTurnId: string | null;
  threadId: string | null;
  deltaItemIds: Set<string>;
  toolItemIds: Set<string>;
  errorEmitted: boolean;
  finished: boolean;
  finishReason: TurnReason | null;
}

export function createTurnState(turnId: string): CodexTurnState {
  return {
    turnId,
    codexTurnId: null,
    threadId: null,
    deltaItemIds: new Set<string>(),
    toolItemIds: new Set<string>(),
    errorEmitted: false,
    finished: false,
    finishReason: null,
  };
}

const TOOL_ITEM_TYPES: Record<string, true> = {
  commandExecution: true,
  fileChange: true,
  mcpToolCall: true,
  dynamicToolCall: true,
  webSearch: true,
  imageView: true,
  imageGeneration: true,
  collabAgentToolCall: true,
  subAgentActivity: true,
  sleep: true,
};

const MAX_TOOL_OUTPUT = 8192;

/**
 * Bind a codex turn id to the contract turn. The first observed id wins, and
 * later notifications for a different turn are ignored so a shared app-server
 * cannot leak another thread's output into this stream.
 */
function acceptTurn(state: CodexTurnState, codexTurnId: string | null): boolean {
  if (codexTurnId === null) return true;
  if (state.codexTurnId === null) {
    state.codexTurnId = codexTurnId;
    return true;
  }
  return state.codexTurnId === codexTurnId;
}

function acceptThread(state: CodexTurnState, threadId: string | null): boolean {
  if (threadId === null) return true;
  if (state.threadId === null) {
    state.threadId = threadId;
    return true;
  }
  return state.threadId === threadId;
}

function turnIdOf(params: JsonRecord): string | null {
  return readString(params.turnId) ?? readString(asRecord(params.turn)?.id);
}

function readDelta(params: JsonRecord): string | null {
  const delta = readString(params.delta);
  return delta === null ? null : delta;
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT) return value;
  return `${value.slice(0, MAX_TOOL_OUTPUT)}\n... (truncated)`;
}

function summarize(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return truncate(value);
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return '';
  }
}

/**
 * Map a codex item type to the tool name surfaced in the contract. Names are
 * stable so the UI can group calls without reading vendor payloads.
 */
export function codexToolName(item: JsonRecord): string {
  const type = readString(item.type) ?? 'unknown';
  switch (type) {
    case 'commandExecution':
      return 'command';
    case 'fileChange':
      return 'apply_patch';
    case 'mcpToolCall': {
      const server = readString(item.server);
      const tool = readString(item.tool);
      if (server !== null && tool !== null) return `${server}.${tool}`;
      return tool ?? server ?? 'mcp_tool';
    }
    case 'dynamicToolCall':
      return readString(item.tool) ?? 'dynamic_tool';
    case 'collabAgentToolCall':
      return readString(item.tool) ?? 'collab_agent';
    case 'webSearch':
      return 'web_search';
    case 'imageView':
      return 'view_image';
    case 'imageGeneration':
      return 'image_generation';
    case 'subAgentActivity':
      return 'sub_agent';
    case 'sleep':
      return 'sleep';
    default:
      return type;
  }
}

function toolInput(item: JsonRecord): unknown {
  switch (readString(item.type)) {
    case 'commandExecution':
      return { command: item.command, cwd: item.cwd };
    case 'fileChange':
      return { changes: item.changes };
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return item.arguments;
    case 'imageView':
      return { path: item.path };
    case 'webSearch':
      return { query: item.query };
    default:
      return null;
  }
}

function toolOutput(item: JsonRecord): string {
  switch (readString(item.type)) {
    case 'commandExecution': {
      const output = readString(item.aggregatedOutput) ?? '';
      const exitCode = readInteger(item.exitCode);
      if (output.length === 0 && exitCode !== null) return `exit code ${exitCode}`;
      return truncate(output);
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes.length : 0;
      const status = readString(item.status) ?? 'unknown';
      return `${changes} file change(s), status ${status}`;
    }
    case 'mcpToolCall':
      return summarize(item.result ?? item.error);
    case 'dynamicToolCall':
      return summarize(item.contentItems ?? item.success);
    default:
      return summarize(item);
  }
}

function itemIsError(item: JsonRecord): boolean {
  const status = readString(item.status);
  switch (readString(item.type)) {
    case 'commandExecution':
      if (status !== null && status !== 'completed') return true;
      return (readInteger(item.exitCode) ?? 0) !== 0;
    case 'fileChange':
      return status !== null && status !== 'completed';
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return status === 'failed' || item.success === false;
    default:
      return false;
  }
}

function mapItemStarted(item: JsonRecord, state: CodexTurnState): AdapterEvent[] {
  const itemId = readString(item.id);
  const type = readString(item.type);
  if (itemId === null || type === null) return [];
  if (TOOL_ITEM_TYPES[type] !== true) return [];

  state.toolItemIds.add(itemId);
  return [
    {
      type: 'tool.started',
      turnId: state.turnId,
      toolCallId: itemId,
      name: codexToolName(item),
      input: toolInput(item),
    },
  ];
}

function mapItemCompleted(item: JsonRecord, state: CodexTurnState): AdapterEvent[] {
  const itemId = readString(item.id);
  const type = readString(item.type);
  if (itemId === null || type === null) return [];

  if (TOOL_ITEM_TYPES[type] === true) {
    state.toolItemIds.delete(itemId);
    return [
      {
        type: 'tool.finished',
        turnId: state.turnId,
        toolCallId: itemId,
        output: toolOutput(item),
        isError: itemIsError(item),
      },
    ];
  }

  // Text normally streams as deltas. If the server only reports the finished
  // item, surface the final text once so the assistant reply is not lost.
  if (state.deltaItemIds.has(itemId)) return [];

  if (type === 'agentMessage') {
    const text = readString(item.text);
    if (text === null) return [];
    state.deltaItemIds.add(itemId);
    return [{ type: 'text.delta', turnId: state.turnId, text }];
  }

  if (type === 'reasoning') {
    const summary = Array.isArray(item.summary) ? item.summary.filter(isText).join('\n') : '';
    const content = Array.isArray(item.content) ? item.content.filter(isText).join('\n') : '';
    const text = summary.length > 0 ? summary : content;
    if (text.length === 0) return [];
    state.deltaItemIds.add(itemId);
    return [{ type: 'reasoning.delta', turnId: state.turnId, text }];
  }

  return [];
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Map the codex terminal turn status onto the contract reason. */
export function mapTurnStatus(status: string | null): TurnReason {
  switch (status) {
    case 'completed':
      return 'complete';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
      return 'error';
    default:
      return 'error';
  }
}

/** Map a `thread/tokenUsage/updated` payload; `last` is the per-turn delta. */
export function mapUsage(params: unknown, state: CodexTurnState): AdapterEvent[] {
  const record = asRecord(params);
  if (record === null) return [];
  if (!acceptThread(state, readString(record.threadId))) return [];
  if (!acceptTurn(state, turnIdOf(record))) return [];

  const tokenUsage = asRecord(record.tokenUsage);
  if (tokenUsage === null) return [];
  const last = asRecord(tokenUsage.last) ?? asRecord(tokenUsage.total);
  if (last === null) return [];

  const inputTokens = readInteger(last.inputTokens);
  const outputTokens = readInteger(last.outputTokens);
  if (inputTokens === null && outputTokens === null) return [];

  return [
    {
      type: 'usage',
      turnId: state.turnId,
      ...(inputTokens === null ? {} : { inputTokens }),
      ...(outputTokens === null ? {} : { outputTokens }),
    },
  ];
}

function mapError(params: JsonRecord, state: CodexTurnState): AdapterEvent[] {
  if (!acceptThread(state, readString(params.threadId))) return [];
  if (!acceptTurn(state, turnIdOf(params))) return [];

  const message = readString(asRecord(params.error)?.message) ?? 'codex reported an error';
  state.errorEmitted = true;
  return [
    {
      type: 'error',
      message: `codex: ${message}`,
      retryable: params.willRetry === true,
    },
  ];
}

function mapTurnCompleted(params: JsonRecord, state: CodexTurnState): AdapterEvent[] {
  if (!acceptThread(state, readString(params.threadId))) return [];
  const turn = asRecord(params.turn);
  if (!acceptTurn(state, turn === null ? null : readString(turn.id))) return [];

  const reason = mapTurnStatus(turn === null ? null : readString(turn.status));
  const events: AdapterEvent[] = [];

  if (reason === 'error' && !state.errorEmitted) {
    const message = readString(asRecord(turn?.error)?.message) ?? 'codex turn failed';
    state.errorEmitted = true;
    events.push({ type: 'error', message: `codex: ${message}`, retryable: false });
  }

  state.finished = true;
  state.finishReason = reason;
  events.push({ type: 'turn.finished', turnId: state.turnId, reason });
  return events;
}

/**
 * Translate one server notification into contract events. Unknown methods and
 * unrelated thread/turn ids yield an empty array, which keeps the adapter
 * forward compatible with newer app-server releases.
 */
export function mapNotification(method: string, params: unknown, state: CodexTurnState): AdapterEvent[] {
  const record = asRecord(params) ?? {};

  if (method === CODEX_METHODS.threadStarted) {
    acceptThread(state, readString(asRecord(record.thread)?.id));
    return [];
  }
  if (method === CODEX_METHODS.serverRequestResolved) return [];

  if (method === CODEX_METHODS.turnStarted) {
    if (!acceptThread(state, readString(record.threadId))) return [];
    acceptTurn(state, turnIdOf(record));
    return [];
  }

  if (!acceptThread(state, readString(record.threadId))) return [];
  if (!acceptTurn(state, turnIdOf(record))) return [];

  switch (method) {
    case CODEX_METHODS.agentMessageDelta: {
      const delta = readDelta(record);
      const itemId = readString(record.itemId);
      if (delta === null) return [];
      if (itemId !== null) state.deltaItemIds.add(itemId);
      return [{ type: 'text.delta', turnId: state.turnId, text: delta }];
    }

    case CODEX_METHODS.reasoningTextDelta:
    case CODEX_METHODS.reasoningSummaryDelta: {
      const delta = readDelta(record);
      const itemId = readString(record.itemId);
      if (delta === null) return [];
      if (itemId !== null) state.deltaItemIds.add(itemId);
      return [{ type: 'reasoning.delta', turnId: state.turnId, text: delta }];
    }

    case CODEX_METHODS.itemStarted: {
      const item = asRecord(record.item);
      return item === null ? [] : mapItemStarted(item, state);
    }

    case CODEX_METHODS.itemCompleted: {
      const item = asRecord(record.item);
      return item === null ? [] : mapItemCompleted(item, state);
    }

    case CODEX_METHODS.commandOutputDelta:
    case CODEX_METHODS.fileChangeOutputDelta: {
      const delta = readDelta(record);
      const itemId = readString(record.itemId);
      if (delta === null || itemId === null) return [];
      return [{ type: 'tool.delta', turnId: state.turnId, toolCallId: itemId, text: delta }];
    }

    case CODEX_METHODS.tokenUsage:
      return mapUsage(record, state);

    case CODEX_METHODS.error:
      return mapError(record, state);

    case CODEX_METHODS.turnCompleted:
      return mapTurnCompleted(record, state);

    default:
      return [];
  }
}

export interface CodexApprovalMapping {
  approvalId: string;
  toolCallId: string;
  name: string;
  input: unknown;
  /** Set when the adapter should answer without asking the user. */
  autoDecision: ApprovalWireDecision | null;
  /** Contract event, null when `autoDecision` is set. */
  event: AdapterEvent | null;
}

/** Approval methods this adapter understands, including the legacy v1 pair. */
export function isApprovalMethod(method: string): boolean {
  return (
    method === CODEX_METHODS.commandApproval ||
    method === CODEX_METHODS.fileChangeApproval ||
    method === CODEX_METHODS.legacyExecApproval ||
    method === CODEX_METHODS.legacyPatchApproval
  );
}

/**
 * Map a server-initiated approval request. `accept-edits` answers file changes
 * itself and only asks about commands; `full-auto` answers everything because
 * the server should not be prompting in that mode.
 */
export function mapApprovalRequest(
  method: string,
  params: unknown,
  mode: PermissionMode,
  turnId: string,
): CodexApprovalMapping | null {
  if (!isApprovalMethod(method)) return null;

  const record = asRecord(params) ?? {};
  const isFileChange = method === CODEX_METHODS.fileChangeApproval || method === CODEX_METHODS.legacyPatchApproval;
  const toolCallId =
    readString(record.itemId) ?? readString(record.call_id) ?? readString(record.callId) ?? `rpc-${method}`;
  const approvalId = readString(record.approvalId) ?? toolCallId;
  const name = isFileChange ? 'apply_patch' : 'command';

  const autoDecision: ApprovalWireDecision | null =
    mode === 'full-auto' || (mode === 'accept-edits' && isFileChange) ? 'accept' : null;

  return {
    approvalId,
    toolCallId,
    name,
    input: record,
    autoDecision,
    event:
      autoDecision === null
        ? {
            type: 'approval.requested',
            turnId,
            approvalId,
            toolCallId,
            name,
            input: record,
          }
        : null,
  };
}

/**
 * Replay entry point for recorded fixtures: one decoded frame in, contract
 * events out. Server requests produce the same approval event the live adapter
 * would emit.
 */
export function mapCodexMessage(
  message: RpcMessage,
  state: CodexTurnState,
  mode: PermissionMode = 'ask',
): AdapterEvent[] {
  if (message.kind === 'notification') {
    return mapNotification(message.method, message.params, state);
  }
  if (message.kind === 'request') {
    const mapping = mapApprovalRequest(message.method, message.params, mode, state.turnId);
    if (mapping === null || mapping.event === null) return [];
    return [mapping.event];
  }
  return [];
}
