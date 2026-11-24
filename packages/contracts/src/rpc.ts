import { z } from 'zod';
import {
  ApprovalChoiceSchema,
  AttachmentSchema,
  BrainEntrySchema,
  BrainKindSchema,
  BrainSliceSchema,
  CheckpointSchema,
  CommandSchema,
  DiffFileSchema,
  ExecutionModeSchema,
  GoalAutonomySchema,
  GoalSchema,
  IdSchema,
  ModelSchema,
  PermissionModeSchema,
  ProjectSchema,
  ProviderConfigSchema,
  ProviderKindSchema,
  ProviderViewSchema,
  ReviewCommentSchema,
  ReviewCommentSideSchema,
  ReviewSchema,
  SeqSchema,
  SkillSchema,
  TaskSchema,
  ThreadSchema,
} from './entities.js';
import { ServerEventSchema, ThreadEventRowSchema, type ServerEvent } from './events.js';
import { SettingsPatchSchema, SettingsSchema } from './settings.js';

export const PROTOCOL_VERSION = 1;

export const EmptyObjectSchema = z.object({});

export const RpcErrorCodeSchema = z.enum([
  'unauthorized',
  'bad-request',
  'not-found',
  'conflict',
  'provider-unavailable',
  'permission-denied',
  'internal',
]);
export type RpcErrorCode = z.infer<typeof RpcErrorCodeSchema>;

export const RpcErrorSchema = z.object({
  code: RpcErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type RpcError = z.infer<typeof RpcErrorSchema>;

export const ClientRequestSchema = z.object({
  id: IdSchema,
  method: z.string().min(1),
  params: z.unknown(),
});
export type ClientRequest = z.infer<typeof ClientRequestSchema>;

export const ServerResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    id: IdSchema,
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    id: IdSchema,
    ok: z.literal(false),
    error: RpcErrorSchema,
  }),
]);
export type ServerResponse = z.infer<typeof ServerResponseSchema>;

export const ServerEventFrameSchema = ServerEventSchema;
export type ServerEventFrame = ServerEvent;

type RpcMethodDefinition = {
  readonly params: z.ZodType;
  readonly result: z.ZodType;
};

const idParam = z.object({ id: IdSchema });
const threadIdParam = z.object({ threadId: IdSchema });
const projectIdParam = z.object({ projectId: IdSchema });

export const methods = {
  'app.health': {
    params: EmptyObjectSchema,
    result: z.object({
      version: z.string(),
      pid: z.number().int().positive(),
      uptimeMs: z.number().nonnegative(),
      dbPath: z.string(),
    }),
  },
  'projects.list': {
    params: EmptyObjectSchema,
    result: ProjectSchema.array(),
  },
  'projects.add': {
    params: z.object({ path: z.string().min(1) }),
    result: ProjectSchema,
  },
  'projects.remove': {
    params: z.object({
      id: IdSchema,
      deleteWorktrees: z.boolean().optional(),
    }),
    result: EmptyObjectSchema,
  },
  'projects.refresh': {
    params: idParam,
    result: ProjectSchema,
  },
  'threads.list': {
    params: z.object({ projectId: IdSchema.optional() }),
    result: ThreadSchema.array(),
  },
  'threads.create': {
    params: z.object({
      projectId: IdSchema,
      title: z.string().optional(),
      providerId: IdSchema,
      modelId: z.string(),
      executionMode: ExecutionModeSchema,
      permissionMode: PermissionModeSchema,
      baseBranch: z.string().optional(),
    }),
    result: ThreadSchema,
  },
  'threads.get': {
    params: idParam,
    result: ThreadSchema,
  },
  'threads.update': {
    params: z.object({
      id: IdSchema,
      title: z.string().optional(),
      modelId: z.string().optional(),
      executionMode: ExecutionModeSchema.optional(),
      permissionMode: PermissionModeSchema.optional(),
    }),
    result: ThreadSchema,
  },
  'threads.delete': {
    params: z.object({
      id: IdSchema,
      removeWorktree: z.boolean().optional(),
    }),
    result: EmptyObjectSchema,
  },
  'threads.send': {
    params: z.object({
      id: IdSchema,
      text: z.string(),
      attachments: AttachmentSchema.array().optional(),
    }),
    result: z.object({ turnId: z.string() }),
  },
  'threads.interrupt': {
    params: idParam,
    result: EmptyObjectSchema,
  },
  'threads.approve': {
    params: z.object({
      threadId: IdSchema,
      approvalId: IdSchema,
      decision: ApprovalChoiceSchema,
    }),
    result: EmptyObjectSchema,
  },
  'threads.events': {
    params: z.object({
      id: IdSchema,
      sinceSeq: SeqSchema.optional(),
      limit: z.number().int().positive().optional(),
    }),
    result: z.object({
      events: ThreadEventRowSchema.array(),
      hasMore: z.boolean(),
    }),
  },
  'checkpoints.create': {
    params: z.object({ threadId: IdSchema, label: z.string() }),
    result: CheckpointSchema,
  },
  'checkpoints.list': {
    params: threadIdParam,
    result: CheckpointSchema.array(),
  },
  'checkpoints.revert': {
    params: z.object({ threadId: IdSchema, checkpointId: IdSchema }),
    result: EmptyObjectSchema,
  },
  'diff.get': {
    params: z.object({
      threadId: IdSchema,
      checkpointId: IdSchema.optional(),
    }),
    result: z.object({ files: DiffFileSchema.array() }),
  },
  'comments.list': {
    params: threadIdParam,
    result: ReviewCommentSchema.array(),
  },
  'comments.add': {
    params: z.object({
      threadId: IdSchema,
      filePath: z.string().min(1),
      line: z.number().int().positive(),
      side: ReviewCommentSideSchema,
      body: z.string().min(1),
    }),
    result: ReviewCommentSchema,
  },
  'comments.resolve': {
    params: z.object({
      id: IdSchema,
      resolved: z.boolean(),
    }),
    result: ReviewCommentSchema,
  },
  'git.commit': {
    params: z.object({ threadId: IdSchema, message: z.string() }),
    result: z.object({ sha: z.string() }),
  },
  'git.push': {
    params: threadIdParam,
    result: z.object({ branch: z.string(), remote: z.string() }),
  },
  'git.pr': {
    params: z.object({
      threadId: IdSchema,
      title: z.string(),
      body: z.string(),
      draft: z.boolean().optional(),
    }),
    result: z.object({ url: z.string(), number: z.number().int().positive() }),
  },
  'terminal.open': {
    params: z.object({
      threadId: IdSchema,
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    result: z.object({ terminalId: IdSchema }),
  },
  'terminal.input': {
    params: z.object({ terminalId: IdSchema, data: z.string() }),
    result: EmptyObjectSchema,
  },
  'terminal.resize': {
    params: z.object({
      terminalId: IdSchema,
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    result: EmptyObjectSchema,
  },
  'terminal.close': {
    params: z.object({ terminalId: IdSchema }),
    result: EmptyObjectSchema,
  },
  'providers.list': {
    params: EmptyObjectSchema,
    result: ProviderViewSchema.array(),
  },
  'providers.upsert': {
    params: z.object({
      id: IdSchema.optional(),
      kind: ProviderKindSchema,
      label: z.string(),
      config: ProviderConfigSchema,
      secret: z.string().optional(),
    }),
    result: ProviderViewSchema,
  },
  'providers.remove': {
    params: idParam,
    result: EmptyObjectSchema,
  },
  'providers.test': {
    params: idParam,
    result: z.object({ ok: z.boolean(), detail: z.string() }),
  },
  'models.list': {
    params: z.object({ providerId: IdSchema }),
    result: ModelSchema.array(),
  },
  'settings.get': {
    params: EmptyObjectSchema,
    result: SettingsSchema,
  },
  'settings.set': {
    params: z.object({ patch: SettingsPatchSchema }),
    result: SettingsSchema,
  },
  'brain.list': {
    params: z.object({
      kind: BrainKindSchema.optional(),
      projectId: IdSchema.optional(),
      query: z.string().optional(),
      limit: z.number().int().positive().optional(),
      includeInactive: z.boolean().optional(),
    }),
    result: BrainEntrySchema.array(),
  },
  'brain.upsert': {
    params: z.object({
      id: IdSchema.optional(),
      kind: BrainKindSchema,
      scope: z.string().min(1),
      projectId: IdSchema.nullable().optional(),
      text: z.string().min(1),
      tags: z.string().optional(),
      appliesTo: z.string().optional(),
      importance: z.number().min(0).max(1).optional(),
      active: z.boolean().optional(),
    }),
    result: BrainEntrySchema,
  },
  'brain.delete': {
    params: idParam,
    result: EmptyObjectSchema,
  },
  'brain.preview': {
    params: z.object({
      projectId: IdSchema,
      threadId: IdSchema.optional(),
      message: z.string(),
    }),
    result: BrainSliceSchema,
  },
  'council.start': {
    params: z.object({
      threadId: IdSchema,
      goal: z.string().min(1),
      autonomy: GoalAutonomySchema,
    }),
    result: z.object({ goalId: IdSchema }),
  },
  'council.cancel': {
    params: z.object({ goalId: IdSchema }),
    result: EmptyObjectSchema,
  },
  'council.status': {
    params: z.object({ goalId: IdSchema }),
    result: z.object({
      goal: GoalSchema,
      tasks: TaskSchema.array(),
      reviews: ReviewSchema.array(),
    }),
  },
  'commands.list': {
    params: projectIdParam,
    result: CommandSchema.array(),
  },
  'skills.list': {
    params: projectIdParam,
    result: SkillSchema.array(),
  },
  'diagnostics.export': {
    params: EmptyObjectSchema,
    result: z.object({ path: z.string() }),
  },
} satisfies Record<string, RpcMethodDefinition>;

export type RpcMethod = keyof typeof methods;
export type RpcParams<M extends RpcMethod> = z.infer<(typeof methods)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.infer<(typeof methods)[M]['result']>;

export const RPC_METHODS = Object.keys(methods) as RpcMethod[];
