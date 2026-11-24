export type PaletteKind = 'command' | 'skill';

export interface TriggerMatch {
  kind: PaletteKind;
  query: string;
}

const LEADING_TRIGGER = /^([/$])([\w-]*)$/;

/**
 * Matches only a leading token: the whole input is `/name` or `$name`.
 * A space (or any other character) closes the palette.
 */
export function parseTrigger(value: string): TriggerMatch | null {
  const match = LEADING_TRIGGER.exec(value);
  if (!match) return null;
  return { kind: match[1] === '/' ? 'command' : 'skill', query: match[2] ?? '' };
}

export function triggerInsert(kind: PaletteKind, name: string): string {
  return `${kind === 'command' ? '/' : '$'}${name} `;
}

export function filterPalette<T extends { name: string }>(
  entries: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = query.toLowerCase();
  const matches = entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  matches.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
    const bPrefix = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
    return aPrefix - bPrefix || a.name.localeCompare(b.name);
  });
  return matches.slice(0, limit);
}
