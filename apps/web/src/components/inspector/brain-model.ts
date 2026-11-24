import type { BrainEntry, BrainKind, BrainSlice, RpcParams } from '@tuffcode/contracts';

export const BRAIN_KINDS = [
  'identity',
  'preference',
  'rule',
  'project',
  'memory',
  'working-note',
] as const satisfies readonly BrainKind[];

export const BRAIN_KIND_LABEL: Record<BrainKind, string> = {
  identity: 'Identity',
  preference: 'Preference',
  rule: 'Rule',
  project: 'Project',
  memory: 'Memory',
  'working-note': 'Working note',
};

/** The inspector creates the kinds a person writes by hand; the rest are learned. */
export const CREATABLE_BRAIN_KINDS = ['rule', 'preference'] as const satisfies readonly BrainKind[];

const tokenFormatter = new Intl.NumberFormat('en-US');

export function formatTokenCount(tokens: number): string {
  const count = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  return `${tokenFormatter.format(count)} ${count === 1 ? 'token' : 'tokens'}`;
}

export function summarizeBrainSlice(slice: BrainSlice): string {
  return `${slice.always.length} always, ${slice.retrieved.length} retrieved, ${formatTokenCount(slice.tokens)}`;
}

export function isBrainSliceEmpty(slice: BrainSlice): boolean {
  return slice.always.length === 0 && slice.retrieved.length === 0;
}

/** Active entries first, then most recently updated, then by id for a stable order. */
export function sortBrainEntries(entries: readonly BrainEntry[]): BrainEntry[] {
  return entries.toSorted((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}

export function brainEntryMeta(entry: BrainEntry): string {
  const parts = [entry.scope];
  if (entry.appliesTo !== null && entry.appliesTo.length > 0) parts.push(entry.appliesTo);
  if (entry.tags.length > 0) parts.push(entry.tags);
  parts.push(`importance ${entry.importance.toFixed(2)}`);
  return parts.join(' | ');
}

/**
 * Round-trips every field the repository stores so a toggle cannot clear data:
 * the upsert schema has no defaults, and an omitted projectId would otherwise
 * drop a project-scoped entry to global.
 */
export function toggleBrainEntryParams(entry: BrainEntry): RpcParams<'brain.upsert'> {
  return {
    id: entry.id,
    kind: entry.kind,
    scope: entry.scope,
    projectId: entry.projectId,
    text: entry.text,
    tags: entry.tags,
    ...(entry.appliesTo === null ? {} : { appliesTo: entry.appliesTo }),
    importance: entry.importance,
    active: !entry.active,
  };
}
