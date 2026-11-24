import type { LogLevel, PermissionMode, Settings, SettingsPatch, Theme } from '@tuffcode/contracts';

export interface GeneralDraft {
  theme: Theme;
  shell: string;
  defaultPermissionMode: PermissionMode;
  logLevel: LogLevel;
  brainEnabled: boolean;
}

export interface GeneralFieldErrors {
  shell?: string;
}

export function generalDraftFromSettings(settings: Settings): GeneralDraft {
  return {
    theme: settings.theme,
    shell: settings.shell ?? '',
    defaultPermissionMode: settings.defaultPermissionMode,
    logLevel: settings.logLevel,
    brainEnabled: settings.brainEnabled,
  };
}

export function generalDraftsEqual(a: GeneralDraft, b: GeneralDraft): boolean {
  return (
    a.theme === b.theme &&
    a.shell === b.shell &&
    a.defaultPermissionMode === b.defaultPermissionMode &&
    a.logLevel === b.logLevel &&
    a.brainEnabled === b.brainEnabled
  );
}

export function validateGeneralDraft(draft: GeneralDraft): GeneralFieldErrors {
  for (const char of draft.shell.trim()) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return { shell: 'Shell cannot contain control characters.' };
    }
  }

  return {};
}

export function buildSettingsPatch(draft: GeneralDraft): SettingsPatch {
  const shell = draft.shell.trim();
  return {
    theme: draft.theme,
    shell: shell ? shell : null,
    defaultPermissionMode: draft.defaultPermissionMode,
    logLevel: draft.logLevel,
    brainEnabled: draft.brainEnabled,
  };
}
