/**
 * Wire names used by the Codex app-server. The set is a subset of the
 * generated protocol schema vendored with codex-rs/app-server-protocol
 * (schema/typescript/ClientRequest.ts, ServerNotification.ts, ServerRequest.ts).
 *
 * The transport is newline-delimited JSON with the JSON-RPC 2.0 envelope
 * minus the `jsonrpc` field: requests are `{ id, method, params }`, responses
 * are `{ id, result }` or `{ id, error: { code, message, data } }`, and
 * notifications are `{ method, params }`.
 */
export const CODEX_METHODS = {
  initialize: 'initialize',
  initialized: 'initialized',
  threadStart: 'thread/start',
  threadResume: 'thread/resume',
  turnStart: 'turn/start',
  turnInterrupt: 'turn/interrupt',
  commandApproval: 'item/commandExecution/requestApproval',
  fileChangeApproval: 'item/fileChange/requestApproval',
  legacyExecApproval: 'execCommandApproval',
  legacyPatchApproval: 'applyPatchApproval',
  serverRequestResolved: 'serverRequest/resolved',
  agentMessageDelta: 'item/agentMessage/delta',
  reasoningTextDelta: 'item/reasoning/textDelta',
  reasoningSummaryDelta: 'item/reasoning/summaryTextDelta',
  itemStarted: 'item/started',
  itemCompleted: 'item/completed',
  commandOutputDelta: 'item/commandExecution/outputDelta',
  fileChangeOutputDelta: 'item/fileChange/outputDelta',
  turnStarted: 'turn/started',
  turnCompleted: 'turn/completed',
  threadStarted: 'thread/started',
  tokenUsage: 'thread/tokenUsage/updated',
  error: 'error',
} as const;

/** JSON-RPC error code returned for server requests this adapter cannot answer. */
export const UNSUPPORTED_SERVER_REQUEST = -32601;

/** Default deadline for a single app-server request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
