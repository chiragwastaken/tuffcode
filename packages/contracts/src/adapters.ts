import type { ApprovalChoice, PermissionMode, ProviderKind, SubagentType } from './entities.js';
import type { AdapterEvent } from './events.js';

export interface TurnContext {
  turnId: string;
  cwd: string;
  systemPrompt: string;
  permissionMode: PermissionMode;
  model: string;
  brainSlice: string;
  attachments: { path: string; kind: 'file' | 'image' }[];
  signal: AbortSignal;
  /** Tool names the user enabled in settings; unset means every harness tool. */
  toolAllowlist?: string[];
  /** Per-turn cap on tool round-trips; unset leaves the adapter's own cap in force. */
  maxToolIterations?: number;
  /** Output token cap for this turn; unset leaves the adapter's configured default. */
  maxOutputTokens?: number;
}

export interface AdapterCapabilities {
  tools: boolean;
  approvals: boolean;
  resume: boolean;
  models: boolean;
}

export interface AdapterSession {
  readonly id: string;
  readonly providerId: string;
  readonly capabilities: AdapterCapabilities;
  send(text: string, ctx: TurnContext): AsyncIterable<AdapterEvent>;
  approve(approvalId: string, decision: ApprovalChoice): void;
  interrupt(): Promise<void>;
  /**
   * Trims the adapter's in-memory history to a summary plus the last two messages.
   * Only the harness adapters implement this; vendor CLIs report their own usage and
   * leave history to the vendor. A failed summary leaves history untouched and
   * reports zero removed.
   */
  compact?(): Promise<CompactResult>;
  dispose(): Promise<void>;
}

export interface CompactResult {
  /** Messages folded into the summary; zero when nothing was trimmed. */
  removed: number;
}

export interface AdapterLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** One enabled stdio MCP server as a vendor CLI must launch it. */
export interface McpServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AdapterDeps {
  logger: AdapterLogger;
  resolveCommand(name: string): Promise<string | null>;
  env: Record<string, string | undefined>;
  /**
   * Spawns a typed subagent for the parent turn that owns `cwd`. The harness passes
   * the turn cwd because the adapter never sees the thread id; the server resolves
   * the parent thread from the worktree and rejects nested or read-only turns.
   */
  spawnSubagent?(request: SubagentToolRequest): Promise<SubagentToolResult>;
  /**
   * Runs one of the server-owned tools (`mcp`, `memory`, `config`) for a turn. The
   * harness passes the turn cwd because the server resolves the thread from it. When
   * unset the harness offers no extra tools and a stray call is answered as unavailable.
   */
  extraTool?: ExtraToolRunner;
  /**
   * Enabled stdio MCP servers keyed by unique display name. Vendor CLIs that launch
   * servers themselves read this; harness adapters reach MCP through `extraTool`.
   */
  mcpServers?: Record<string, McpServerLaunch>;
}

/** Server-owned harness tools: the adapter only shapes the schema and permission. */
export type ExtraToolName = 'mcp' | 'memory' | 'config';

export type ExtraToolRunner = (
  name: ExtraToolName,
  args: Record<string, unknown>,
  ctx: { cwd: string },
) => Promise<string>;

export interface SubagentToolRequest {
  /** Absolute worktree of the parent turn. */
  cwd: string;
  type: SubagentType;
  task: string;
  model?: string;
}

export interface SubagentToolResult {
  childId: string;
  status: string;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  config: Record<string, unknown>;
  secret: string | null;
}

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  isDefault?: boolean;
}

export class AdapterUnavailableError extends Error {
  readonly code = 'provider-unavailable';
  readonly providerId: string;
  readonly hint: string;

  constructor(providerId: string, hint: string, options?: ErrorOptions) {
    super(`provider ${providerId} is unavailable`, options);
    this.name = 'AdapterUnavailableError';
    this.providerId = providerId;
    this.hint = hint;
  }
}
