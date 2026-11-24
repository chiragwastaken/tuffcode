import { DEFAULT_SETTINGS, SettingsPatchSchema, type Settings } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_SETTING_KEYS,
  MAX_OUTPUT_TOKENS_MAX,
  MAX_OUTPUT_TOKENS_MIN,
  maxOutputTokensError,
} from './context-limits';
import { buildSettingsPatch, pickSettings } from './settings-draft';

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('context settings payload', () => {
  it('sends only the context fields the user changed', () => {
    const stored = settings();
    const draft = { ...pickSettings(stored, CONTEXT_SETTING_KEYS), maxOutputTokens: 4096 };
    const patch = buildSettingsPatch(draft, stored, CONTEXT_SETTING_KEYS);

    expect(patch).toEqual({ maxOutputTokens: 4096 });
    expect(SettingsPatchSchema.parse(patch)).toEqual({ maxOutputTokens: 4096 });
  });

  it('sends the threshold, auto-compact, and meter toggles', () => {
    const stored = settings();
    const draft = {
      ...pickSettings(stored, CONTEXT_SETTING_KEYS),
      contextWarningThreshold: 0.65,
      autoCompact: false,
      showContextMeter: false,
    };
    const patch = buildSettingsPatch(draft, stored, CONTEXT_SETTING_KEYS);

    expect(patch).toEqual({
      contextWarningThreshold: 0.65,
      autoCompact: false,
      showContextMeter: false,
    });
    expect(SettingsPatchSchema.safeParse(patch).success).toBe(true);
  });

  it('stays empty when the context fields match the stored settings', () => {
    const stored = settings({ maxOutputTokens: 8192, contextWarningThreshold: 0.8 });
    expect(
      buildSettingsPatch(pickSettings(stored, CONTEXT_SETTING_KEYS), stored, CONTEXT_SETTING_KEYS),
    ).toEqual({});
  });
});

describe('maxOutputTokensError', () => {
  it('accepts the contract bounds', () => {
    expect(maxOutputTokensError(MAX_OUTPUT_TOKENS_MIN)).toBeUndefined();
    expect(maxOutputTokensError(MAX_OUTPUT_TOKENS_MAX)).toBeUndefined();
    expect(maxOutputTokensError(8192)).toBeUndefined();
  });

  it('rejects values outside the bounds and fractions', () => {
    expect(maxOutputTokensError(MAX_OUTPUT_TOKENS_MIN - 1)).toContain('between');
    expect(maxOutputTokensError(MAX_OUTPUT_TOKENS_MAX + 1)).toContain('between');
    expect(maxOutputTokensError(8192.5)).toBe('Enter a whole number of tokens.');
    expect(maxOutputTokensError(Number.NaN)).toBe('Enter a whole number of tokens.');
  });
});
