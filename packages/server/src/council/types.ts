import type {
  ExecutionMode,
  Goal,
  GoalAutonomy,
  PermissionMode,
  Review,
  Task,
  Thread,
} from '@tuffcode/contracts';

/** One task exactly as the planner returned it, after validation. */
export interface PlanTask {
  title: string;
  files: string[];
  dependsOn: string[];
  critical: boolean;
  brief: string;
}

export interface CouncilPlan {
  tasks: PlanTask[];
  question: string | null;
}

export type TurnStatus = 'complete' | 'interrupted' | 'error';

/** The outcome of one runner turn, including the assistant text it produced. */
export interface TurnResult {
  threadId: string;
  turnId: string;
  status: TurnStatus;
  text: string;
  error?: string;
}

export interface RunTurnInput {
  threadId: string;
  text: string;
  signal: AbortSignal;
  /** The goal's autonomy, so one bus runner can answer approvals for either mode. */
  autonomy: GoalAutonomy;
}

export interface ChildThreadRequest {
  projectId: string;
  parentThreadId: string;
  title: string;
  providerId: string;
  modelId: string;
  executionMode: ExecutionMode;
  permissionMode: PermissionMode;
  baseBranch: string;
}

/** What the task branch changed relative to its base branch. */
export interface TaskChanges {
  changed: boolean;
  files: string[];
  patch: string;
}

export interface PullRequestRequest {
  title: string;
  body: string;
}

export interface PullRequest {
  url: string;
  number: number;
}

/**
 * Every effect council has on the outside world. The service never imports git, the
 * runner, or the thread helpers directly; it goes through these ports so tests can
 * drive a full goal with fake adapters and no process, network, or disk checkout.
 */
export interface CouncilPorts {
  createThread(request: ChildThreadRequest): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  runTurn(input: RunTurnInput): Promise<TurnResult>;
  /** Answers an approval a child raised; council decides, the runner applies it. */
  approve(threadId: string, approvalId: string, decision: 'allow' | 'deny'): Promise<void>;
  openPullRequest(threadId: string, request: PullRequestRequest): Promise<PullRequest>;
  changesForThread(threadId: string): Promise<TaskChanges>;
}

export interface CouncilStatus {
  goal: Goal;
  tasks: Task[];
  reviews: Review[];
}

export interface CouncilStartInput {
  threadId: string;
  goal: string;
  autonomy: GoalAutonomy;
}

export interface Council {
  /** Creates the goal row and starts orchestration; resolves before planning begins. */
  start(input: CouncilStartInput): Promise<{ goalId: string }>;
  /** Stops every worker, disposes child threads, and marks open rows cancelled. */
  cancel(goalId: string): Promise<void>;
  status(goalId: string): CouncilStatus;
  /** The thread's newest goal with its tasks and reviews; null before the first goal. */
  latest(threadId: string): CouncilStatus | null;
  /** Test and shutdown hook: resolves when the goal run has fully settled. */
  awaitGoal(goalId: string): Promise<Goal>;
  /** Cancels every live goal; safe to call more than once. */
  dispose(): Promise<void>;
}
