import { z } from 'zod';
import { PermissionModeSchema } from './entities.js';

export const ThemeSchema = z.enum(['dark', 'light']);
export type Theme = z.infer<typeof ThemeSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const UpdateChannelSchema = z.enum(['stable', 'beta']);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

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
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = z.object(SettingsFields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
