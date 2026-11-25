import type {
  SubagentControlRequest,
  SubagentMessage,
  AdapterEvent,
  PermissionMode,
  SubagentSpec,
  SubagentStatus,
  SubagentType,
  SubagentView,
  Thread,
} from '@tuffcode/contracts';

/** One child session request, resolved to a concrete provider and model. */
export interface SubagentChildRequest {
  parent: Thread;
  type: SubagentType;
  providerId: string;
  modelId: string;
  permissionMode: PermissionMode;
  /** True only for workers: a fresh `tuffcode/<childId>` worktree. */
  worktree: boolean;
  /** The child's task, which names the child thread. */
  task: string;
}

export interface SubagentTurnInput {
  threadId: string;
  text: string;
  signal: AbortSignal;
  /** Every adapter event of the child turn, already ordered. */
  onEvent(event: AdapterEvent): void;
}

export interface SubagentTurnResult {
  status: 'complete' | 'interrupted' | 'error';
  text: string;
  error?: string;
}

/**
 * Side effects the service does not own. Tests replace them to drive a child turn
 * without a process, a network call, or a checkout.
 */
export interface SubagentPorts {
  createChildThread(request: SubagentChildRequest): Promise<Thread>;
  runTurn(input: SubagentTurnInput): Promise<SubagentTurnResult>;
}

/** Where a type's provider and model came from; surfaced in logs and tests. */
export type SubagentTargetSource = 'spec' | 'settings' | 'fallback' | 'thread';

export interface SubagentTarget {
  providerId: string;
  model: string;
  source: SubagentTargetSource;
}

export interface SubagentSpawnInput {
  threadId: string;
  spec: SubagentSpec;
}

export interface Subagents {
  /** Persists the child as queued and returns at once; the queue starts it. */
  spawn(input: SubagentSpawnInput): Promise<{ childId: string }>;
  /** Harness-tool entry point: the parent is the turn's thread, else the cwd's owner. */
  spawnFromTool(request: {
    cwd: string;
    threadId?: string;
    type: SubagentType;
    task: string;
    model?: string;
  }): Promise<{ childId: string; status: SubagentStatus }>;
  /** status, wait, message, stop, inbox and report for the `subagent` tool. */
  control(request: SubagentControlRequest): Promise<string>;
  /** A follow-up: queued while the child runs, a new turn once it settled. */
  message(childId: string, text: string): Promise<{ delivered: 'queued' | 'started' }>;
  messages(childId: string): SubagentMessage[];
  get(childId: string): SubagentView;
  /** Cancels a queued child or interrupts a running one; settled children are a no-op. */
  cancel(childId: string): Promise<void>;
  list(threadId: string): SubagentView[];
  /** Every child across threads, so the sidebar maps child thread ids without per-parent calls. */
  listAll(): SubagentView[];
  /** Test and shutdown hook: resolves when the child reaches a terminal status. */
  awaitChild(childId: string): Promise<SubagentView>;
  /** Startup recovery: a queued or running child cannot resume after a restart. */
  recoverOrphaned(): number;
  dispose(): Promise<void>;
}
