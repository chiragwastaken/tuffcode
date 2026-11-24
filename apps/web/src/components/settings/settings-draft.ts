import type { Settings, SettingsPatch } from '@tuffcode/contracts';

export type SettingsKey = keyof Settings;

/**
 * Values a section edits, compared by value rather than by reference so an
 * untouched array (enabled tools) does not look dirty after a re-render.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

/**
 * The server stores an empty shell as null, and the form edits it as a string,
 * so both sides are normalised before they are compared or patched.
 */
function normalize(key: SettingsKey, value: unknown): unknown {
  if (key === 'shell' && typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

/** Copies the settings keys a section edits out of the stored settings. */
export function pickSettings<K extends SettingsKey>(
  settings: Settings,
  keys: readonly K[],
): Pick<Settings, K> {
  const picked = {} as Pick<Settings, K>;
  for (const key of keys) picked[key] = settings[key];
  return picked;
}

/** Keys whose draft value differs from the stored settings. */
export function changedSettingsKeys<K extends SettingsKey>(
  draft: Pick<Settings, K>,
  settings: Settings,
  keys: readonly K[],
): K[] {
  return keys.filter(
    (key) => !sameValue(normalize(key, draft[key]), normalize(key, settings[key])),
  );
}

export function isSettingsDraftDirty<K extends SettingsKey>(
  draft: Pick<Settings, K>,
  settings: Settings,
  keys: readonly K[],
): boolean {
  return changedSettingsKeys(draft, settings, keys).length > 0;
}

/**
 * A `settings.set` patch containing only the keys that changed. Sending just the
 * changed keys keeps two sections editing different fields from overwriting each
 * other with stale values.
 */
export function buildSettingsPatch<K extends SettingsKey>(
  draft: Pick<Settings, K>,
  settings: Settings,
  keys: readonly K[],
): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of changedSettingsKeys(draft, settings, keys)) {
    patch[key] = normalize(key, draft[key]);
  }
  return patch as SettingsPatch;
}

/** Rejects control characters, which would break the shell invocation. */
export function shellFieldError(shell: string): string | undefined {
  for (const char of shell.trim()) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return 'Shell cannot contain control characters.';
  }
  return undefined;
}
