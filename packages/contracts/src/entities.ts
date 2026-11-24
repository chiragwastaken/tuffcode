import { z } from 'zod';

export const IdSchema = z.string().min(1);
export const IsoDateTimeSchema = z.iso.datetime();
export const SeqSchema = z.number().int().nonnegative();

export const ExecutionModeSchema = z.enum(['plan', 'work', 'council']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const PermissionModeSchema = z.enum(['read-only', 'ask', 'accept-edits', 'full-auto']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const ThreadStatusSchema = z.enum([
  'idle',
  'running',
  'needs-approval',
  'ready-to-review',
  'failed',
  'merged',
  'closed',
]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const ProviderKindSchema = z.enum([
  'claude',
  'codex',
  'acp',
  'opencode',
  'openai-compatible',
  'anthropic',
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const BrainKindSchema = z.enum([
  'identity',
  'preference',
  'rule',
  'project',
  'memory',
  'working-note',
]);
export type BrainKind = z.infer<typeof BrainKindSchema>;

export const GoalStateSchema = z.enum([
  'intake',
  'planning',
  'provisioning',
  'running',
  'reviewing',
  'reporting',
  'done',
  'failed',
  'cancelled',
]);
export type GoalState = z.infer<typeof GoalStateSchema>;

export const TaskStateSchema = z.enum([
  'queued',
  'provisioning',
  'running',
  'blocked',
  'pr-open',
  'reviewing',
  'changes-requested',
  'passed',
  'merged',
  'awaiting-captain',
  'failed',
  'cancelled',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const ReviewVerdictSchema = z.enum(['pass', 'changes-requested', 'escalate']);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ApprovalDecisionSchema = z.enum(['pending', 'allow', 'allow-thread', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalChoiceSchema = z.enum(['allow', 'allow-thread', 'deny']);
export type ApprovalChoice = z.infer<typeof ApprovalChoiceSchema>;

export const GoalAutonomySchema = z.enum(['manual', 'auto']);
export type GoalAutonomy = z.infer<typeof GoalAutonomySchema>;

export const DiffFileStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflicted',
]);
export type DiffFileStatus = z.infer<typeof DiffFileStatusSchema>;

export const ReviewCommentSideSchema = z.enum(['old', 'new']);
export type ReviewCommentSide = z.infer<typeof ReviewCommentSideSchema>;

export const SubagentTypeSchema = z.enum([
  'explorer',
  'reviewer',
  'notetaker',
  'worker',
  'planner',
]);
export type SubagentType = z.infer<typeof SubagentTypeSchema>;

export const SubagentStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string(),
  path: z.string(),
  defaultBranch: z.string(),
  createdAt: IsoDateTimeSchema,
  lastOpenedAt: IsoDateTimeSchema.nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ThreadSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  parentThreadId: IdSchema.nullable(),
  title: z.string(),
  providerId: IdSchema,
  modelId: z.string(),
  executionMode: ExecutionModeSchema,
  permissionMode: PermissionModeSchema,
  status: ThreadStatusSchema,
  worktreePath: z.string().nullable(),
  branch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  prUrl: z.string().nullable(),
  lastSeq: SeqSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Thread = z.infer<typeof ThreadSchema>;

export const EventRowSchema = z.object({
  id: z.number().int().positive(),
  threadId: IdSchema,
  seq: SeqSchema,
  type: z.string(),
  payload: z.unknown(),
  createdAt: IsoDateTimeSchema,
});
export type EventRow = z.infer<typeof EventRowSchema>;

export const MessageSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  role: MessageRoleSchema,
  content: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type Message = z.infer<typeof MessageSchema>;

export const CheckpointSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  ref: z.string(),
  label: z.string(),
  commitSha: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const ApprovalSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  decision: ApprovalDecisionSchema,
  createdAt: IsoDateTimeSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ProviderConfigSchema = z.record(z.string(), z.unknown());

export const ProviderViewSchema = z.object({
  id: IdSchema,
  kind: ProviderKindSchema,
  label: z.string(),
  config: ProviderConfigSchema,
  enabled: z.boolean(),
  hasSecret: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ProviderView = z.infer<typeof ProviderViewSchema>;

export const ModelSchema = z.object({
  providerId: IdSchema,
  modelId: z.string(),
  label: z.string(),
  contextWindow: z.number().int().positive().nullable(),
  isDefault: z.boolean(),
});
export type Model = z.infer<typeof ModelSchema>;

export const SubagentSpecSchema = z.object({
  type: SubagentTypeSchema,
  task: z.string().min(1),
  model: z.string().optional(),
  providerId: IdSchema.optional(),
  worktree: z.boolean().optional(),
  budgetTokens: z.number().int().positive().optional(),
});
export type SubagentSpec = z.infer<typeof SubagentSpecSchema>;

export const SubagentViewSchema = z.object({
  childId: IdSchema,
  threadId: IdSchema,
  type: SubagentTypeSchema,
  model: z.string(),
  providerId: IdSchema,
  status: SubagentStatusSchema,
  task: z.string(),
  summary: z.string().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SubagentView = z.infer<typeof SubagentViewSchema>;

export const BrainEntrySchema = z.object({
  id: IdSchema,
  kind: BrainKindSchema,
  scope: z.string(),
  projectId: IdSchema.nullable(),
  text: z.string(),
  tags: z.string(),
  appliesTo: z.string().nullable(),
  importance: z.number().min(0).max(1),
  useCount: z.number().int().nonnegative(),
  active: z.boolean(),
  sourceQuote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastUsedAt: IsoDateTimeSchema.nullable(),
});
export type BrainEntry = z.infer<typeof BrainEntrySchema>;

export const BrainSliceSchema = z.object({
  always: BrainEntrySchema.array(),
  retrieved: BrainEntrySchema.array(),
  tokens: z.number().int().nonnegative(),
});
export type BrainSlice = z.infer<typeof BrainSliceSchema>;

export const GoalSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  text: z.string(),
  autonomy: GoalAutonomySchema,
  state: GoalStateSchema,
  createdAt: IsoDateTimeSchema,
  reportedAt: IsoDateTimeSchema.nullable(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  goalId: IdSchema,
  threadId: IdSchema.nullable(),
  title: z.string(),
  brief: z.string(),
  state: TaskStateSchema,
  authorProvider: z.string(),
  authorModel: z.string(),
  reviewerProvider: z.string().nullable(),
  reviewerModel: z.string().nullable(),
  critical: z.boolean(),
  round: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Task = z.infer<typeof TaskSchema>;

export const ReviewSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  providerId: IdSchema,
  modelId: z.string(),
  verdict: ReviewVerdictSchema,
  body: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

export const EscalationSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  question: z.string(),
  answer: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
});
export type Escalation = z.infer<typeof EscalationSchema>;

export const ReviewCommentSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  filePath: z.string(),
  line: z.number().int().positive(),
  side: ReviewCommentSideSchema,
  body: z.string(),
  resolved: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const CommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  path: z.string().nullable(),
});
export type Command = z.infer<typeof CommandSchema>;

export const SkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  path: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const DiffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: DiffFileStatusSchema,
  binary: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullable(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const TerminalSessionSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  cwd: z.string(),
  shell: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

export const AttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  mimeType: z.string().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;
