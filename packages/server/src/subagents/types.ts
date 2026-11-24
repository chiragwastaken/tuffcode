import type {
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
  /** Harness-tool entry point: resolves the parent thread from the turn cwd. */
  spawnFromTool(request: {
    cwd: string;
    type: SubagentType;
    task: string;
    model?: string;
  }): Promise<{ childId: string; status: SubagentStatus }>;
  /** Cancels a queued child or interrupts a running one; settled children are a no-op. */
  cancel(childId: string): Promise<void>;
  list(threadId: string): SubagentView[];
  /** Test and shutdown hook: resolves when the child reaches a terminal status. */
  awaitChild(childId: string): Promise<SubagentView>;
  /** Startup recovery: a queued or running child cannot resume after a restart. */
  recoverOrphaned(): number;
  dispose(): Promise<void>;
}
