import { z } from 'zod';
import {
  ApprovalSchema,
  EventRowSchema,
  GoalStateSchema,
  IdSchema,
  ProviderViewSchema,
  SeqSchema,
  ThreadSchema,
} from './entities.js';
import { SettingsSchema } from './settings.js';

export const AdapterEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.started'),
    sessionId: IdSchema,
    model: z.string(),
    capabilities: z.object({
      tools: z.boolean(),
      approvals: z.boolean(),
      resume: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('turn.started'),
    turnId: IdSchema,
  }),
  z.object({
    type: z.literal('text.delta'),
    turnId: IdSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('reasoning.delta'),
    turnId: IdSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('tool.started'),
    turnId: IdSchema,
    toolCallId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool.delta'),
    turnId: IdSchema,
    toolCallId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('tool.finished'),
    turnId: IdSchema,
    toolCallId: z.string(),
    output: z.string(),
    isError: z.boolean(),
  }),
  z.object({
    type: z.literal('approval.requested'),
    turnId: IdSchema,
    approvalId: IdSchema,
    toolCallId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('usage'),
    turnId: IdSchema,
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('turn.finished'),
    turnId: IdSchema,
    reason: z.enum(['complete', 'interrupted', 'error']),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal('session.ended'),
    reason: z.string(),
  }),
]);
export type AdapterEvent = z.infer<typeof AdapterEventSchema>;
export type AdapterEventType = AdapterEvent['type'];

export const ThreadEventRowSchema = EventRowSchema.extend({
  payload: AdapterEventSchema,
});
export type ThreadEventRow = z.infer<typeof ThreadEventRowSchema>;

const serverEvent = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({
    kind: z.literal('event'),
    type: z.literal(type),
    threadId: IdSchema.optional(),
    seq: SeqSchema.optional(),
    payload,
  });

export const ServerEventSchema = z.discriminatedUnion('type', [
  serverEvent('thread.updated', ThreadSchema),
  z.object({
    kind: z.literal('event'),
    type: z.literal('thread.event'),
    threadId: IdSchema,
    seq: SeqSchema,
    payload: AdapterEventSchema,
  }),
  serverEvent('approval.requested', ApprovalSchema),
  serverEvent(
    'terminal.data',
    z.object({
      terminalId: IdSchema,
      data: z.string(),
    }),
  ),
  serverEvent(
    'council.updated',
    z.object({
      goalId: IdSchema,
      state: GoalStateSchema,
    }),
  ),
  serverEvent('providers.updated', ProviderViewSchema.array()),
  serverEvent('settings.updated', SettingsSchema),
  serverEvent(
    'server.warning',
    z.object({
      message: z.string(),
      code: z.string().optional(),
    }),
  ),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type ServerEventType = ServerEvent['type'];
