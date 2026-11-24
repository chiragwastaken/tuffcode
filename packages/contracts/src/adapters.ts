import type { ApprovalChoice, PermissionMode, ProviderKind } from './entities.js';
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
  dispose(): Promise<void>;
}

export interface AdapterLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface AdapterDeps {
  logger: AdapterLogger;
  resolveCommand(name: string): Promise<string | null>;
  env: Record<string, string | undefined>;
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
