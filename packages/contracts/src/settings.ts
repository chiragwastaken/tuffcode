import { z } from 'zod';
import { PermissionModeSchema } from './entities.js';

export const ThemeSchema = z.enum(['dark', 'light']);
export type Theme = z.infer<typeof ThemeSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const UpdateChannelSchema = z.enum(['stable', 'beta']);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

export const InterfaceSizeSchema = z.enum(['compact', 'default', 'comfortable']);
export type InterfaceSize = z.infer<typeof InterfaceSizeSchema>;

export const CursorStyleSchema = z.enum(['block', 'bar', 'underline']);
export type CursorStyle = z.infer<typeof CursorStyleSchema>;

export const SubagentModelChoiceSchema = z.object({
  providerId: z.string().optional(),
  model: z.string().optional(),
  fallbackModel: z.string().optional(),
});
export type SubagentModelChoice = z.infer<typeof SubagentModelChoiceSchema>;

export const SubagentModelsSchema = z.object({
  explorer: SubagentModelChoiceSchema.default({}),
  reviewer: SubagentModelChoiceSchema.default({}),
  notetaker: SubagentModelChoiceSchema.default({}),
  worker: SubagentModelChoiceSchema.default({}),
  planner: SubagentModelChoiceSchema.default({}),
});
export type SubagentModels = z.infer<typeof SubagentModelsSchema>;

/** Every subagent type starts with an empty model choice. */
export const emptySubagentModels = (): SubagentModels => ({
  explorer: {},
  reviewer: {},
  notetaker: {},
  worker: {},
  planner: {},
});

const SettingsFields = {
  theme: ThemeSchema,
  shell: z.string().nullable(),
  defaultPermissionMode: PermissionModeSchema,
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  worktreeRoot: z.string().nullable(),
  logLevel: LogLevelSchema,
  brainEnabled: z.boolean(),
  updateChannel: UpdateChannelSchema,
  keybindings: z.record(z.string(), z.string()),
  interfaceSize: InterfaceSizeSchema,
  fontSize: z.number().int().min(12).max(20),
  sidebarWidth: z.number().int().min(208).max(360),
  panelAnimation: z.boolean(),
  maxToolIterations: z.number().int().min(1).max(100),
  enabledTools: z.string().array(),
  terminalScrollback: z.number().int().nonnegative(),
  terminalFontSize: z.number().int().min(11).max(20),
  cursorStyle: CursorStyleSchema,
  checkUpdatesOnStart: z.boolean(),
  customInstructions: z.string().max(4000),
  subagentModels: SubagentModelsSchema,
  subagentConcurrency: z.number().int().min(1).max(8),
  contextWarningThreshold: z.number().min(0.5).max(0.95),
  autoCompact: z.boolean(),
  maxOutputTokens: z.number().int().min(256).max(65536),
  showContextMeter: z.boolean(),
  paneLayout: z.unknown().optional(),
};

export const SettingsSchema = z.object({
  theme: SettingsFields.theme.default('dark'),
  shell: SettingsFields.shell.default(null),
  defaultPermissionMode: SettingsFields.defaultPermissionMode.default('ask'),
  defaultProviderId: SettingsFields.defaultProviderId.default(null),
  defaultModelId: SettingsFields.defaultModelId.default(null),
  worktreeRoot: SettingsFields.worktreeRoot.default(null),
  logLevel: SettingsFields.logLevel.default('info'),
  brainEnabled: SettingsFields.brainEnabled.default(true),
  updateChannel: SettingsFields.updateChannel.default('stable'),
  keybindings: SettingsFields.keybindings.default(() => ({})),
  interfaceSize: SettingsFields.interfaceSize.default('default'),
  fontSize: SettingsFields.fontSize.default(14),
  sidebarWidth: SettingsFields.sidebarWidth.default(256),
  panelAnimation: SettingsFields.panelAnimation.default(false),
  maxToolIterations: SettingsFields.maxToolIterations.default(40),
  enabledTools: SettingsFields.enabledTools.default(() => [
    'bash',
    'read',
    'edit',
    'write',
    'glob',
    'grep',
  ]),
  terminalScrollback: SettingsFields.terminalScrollback.default(5000),
  terminalFontSize: SettingsFields.terminalFontSize.default(13),
  cursorStyle: SettingsFields.cursorStyle.default('bar'),
  checkUpdatesOnStart: SettingsFields.checkUpdatesOnStart.default(true),
  customInstructions: SettingsFields.customInstructions.default(''),
  subagentModels: SettingsFields.subagentModels.default(emptySubagentModels),
  subagentConcurrency: SettingsFields.subagentConcurrency.default(4),
  contextWarningThreshold: SettingsFields.contextWarningThreshold.default(0.8),
  autoCompact: SettingsFields.autoCompact.default(true),
  maxOutputTokens: SettingsFields.maxOutputTokens.default(8192),
  showContextMeter: SettingsFields.showContextMeter.default(true),
  paneLayout: SettingsFields.paneLayout,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = z.object(SettingsFields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
