import { DEFAULT_SETTINGS, SettingsPatchSchema } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildSettingsPatch,
  generalDraftFromSettings,
  generalDraftsEqual,
  validateGeneralDraft,
  type GeneralDraft,
} from './general-form';

describe('general settings form', () => {
  it('maps a null shell to an empty draft value', () => {
    expect(generalDraftFromSettings(DEFAULT_SETTINGS)).toEqual({
      theme: 'dark',
      shell: '',
      defaultPermissionMode: 'ask',
      logLevel: 'info',
      brainEnabled: true,
    });
  });

  it('builds a patch with a trimmed shell and null when blank', () => {
    const draft: GeneralDraft = {
      theme: 'light',
      shell: '  C:/Program Files/PowerShell/7/pwsh.exe  ',
      defaultPermissionMode: 'accept-edits',
      logLevel: 'debug',
      brainEnabled: false,
    };
    const patch = buildSettingsPatch(draft);

    expect(patch).toEqual({
      theme: 'light',
      shell: 'C:/Program Files/PowerShell/7/pwsh.exe',
      defaultPermissionMode: 'accept-edits',
      logLevel: 'debug',
      brainEnabled: false,
    });
    expect(SettingsPatchSchema.safeParse(patch).success).toBe(true);

    expect(
      buildSettingsPatch({
        theme: 'dark',
        shell: '   ',
        defaultPermissionMode: 'ask',
        logLevel: 'info',
        brainEnabled: true,
      }).shell,
    ).toBeNull();
  });

  it('rejects control characters in the shell', () => {
    expect(
      validateGeneralDraft({
        theme: 'dark',
        shell: 'pwsh.exe\nwhoami',
        defaultPermissionMode: 'ask',
        logLevel: 'info',
        brainEnabled: true,
      }),
    ).toEqual({ shell: 'Shell cannot contain control characters.' });
  });

  it('accepts paths with spaces and blank shells', () => {
    expect(
      validateGeneralDraft({
        theme: 'dark',
        shell: 'C:/Program Files/PowerShell/7/pwsh.exe',
        defaultPermissionMode: 'ask',
        logLevel: 'info',
        brainEnabled: true,
      }),
    ).toEqual({});
    expect(
      validateGeneralDraft({
        theme: 'dark',
        shell: '',
        defaultPermissionMode: 'ask',
        logLevel: 'info',
        brainEnabled: true,
      }),
    ).toEqual({});
  });

  it('compares drafts by value', () => {
    const draft = generalDraftFromSettings(DEFAULT_SETTINGS);
    expect(generalDraftsEqual(draft, { ...draft })).toBe(true);
    expect(generalDraftsEqual(draft, { ...draft, brainEnabled: false })).toBe(false);
  });
});
