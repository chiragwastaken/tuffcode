import type { BrainEntry, BrainSlice, ExecutionMode } from '@tuffcode/contracts';
import { estimateTokens } from '@tuffcode/prompt';
import type { BrainStore } from './store.js';

/**
 * Per-turn brain assembly, spec section 8.
 *
 * The always block carries identity, standing rules, preferences, the project entry
 * and the working note, capped at 400 tokens. Rules are never dropped or truncated;
 * when the block overflows, the lowest-importance preferences go first. Retrieval is
 * an FTS5 match on the user message scored with importance and recency, capped at
 * 8 entries and another 400 tokens.
 */
export const ALWAYS_TOKEN_BUDGET = 400;
export const RETRIEVAL_TOKEN_BUDGET = 400;
export const RETRIEVAL_MAX_ENTRIES = 8;

const CANDIDATE_LIMIT = 200;

export interface BrainSelectionInput {
  projectId: string;
  /** Thread the turn belongs to; selects its working note over the project one. */
  threadId?: string;
  message: string;
  /** Turn kind used to match `applies_to` on rules. */
  mode?: ExecutionMode;
  /** False disables retrieval entirely (the global brain kill switch). */
  retrieval?: boolean;
  now?: Date;
}

export interface BrainSelection {
  slice: BrainSlice;
  /** The rendered block handed to `buildTurnContext`. */
  text: string;
}

export function renderEntry(entry: BrainEntry): string {
  return `- [${entry.kind}] ${entry.text}`;
}

export function renderBrainEntries(entries: readonly BrainEntry[]): string {
  return entries.map(renderEntry).join('\n');
}

export function brainTokens(entries: readonly BrainEntry[]): number {
  return estimateTokens(renderBrainEntries(entries));
}

function ruleApplies(entry: BrainEntry, mode: ExecutionMode | undefined): boolean {
  const appliesTo = (entry.appliesTo ?? 'all').trim().toLowerCase();
  if (appliesTo.length === 0 || appliesTo === 'all' || appliesTo === '*') return true;
  if (mode === undefined) return false;
  return appliesTo
    .split(/[\s,]+/)
    .filter((value) => value.length > 0)
    .includes(mode);
}

function belongsToProject(entry: BrainEntry, projectId: string | undefined): boolean {
  return entry.projectId === null || entry.projectId === projectId;
}

function byImportanceDesc(a: BrainEntry, b: BrainEntry): number {
  return (
    b.importance - a.importance ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}

function byImportanceAsc(a: BrainEntry, b: BrainEntry): number {
  return (
    a.importance - b.importance ||
    a.updatedAt.localeCompare(b.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}

function termsOf(input: string): string[] {
  return [...new Set(input.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 8);
}

function recencyScore(entry: BrainEntry, now: Date): number {
  const time = Date.parse(entry.lastUsedAt ?? entry.updatedAt);
  if (Number.isNaN(time)) return 0;
  const days = Math.max(0, (now.getTime() - time) / 86_400_000);
  return 1 / (1 + days / 30);
}

function matchScore(entry: BrainEntry, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const haystack = `${entry.text} ${entry.tags}`.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched / terms.length;
}

interface AlwaysGroups {
  identity: BrainEntry[];
  rules: BrainEntry[];
  preferences: BrainEntry[];
  project: BrainEntry[];
  notes: BrainEntry[];
}

/**
 * The working note belongs to the thread, falling back to the project when the
 * thread has none. Entries scoped to neither still apply to the project.
 */
function workingNotes(store: BrainStore, input: BrainSelectionInput): BrainEntry[] {
  const notes = store.list({ kind: 'working-note', limit: CANDIDATE_LIMIT });
  if (input.threadId !== undefined) {
    const forThread = notes.filter((entry) => entry.scope === input.threadId);
    if (forThread.length > 0) return forThread.toSorted(byImportanceDesc);
  }
  const forProject = notes.filter((entry) => entry.scope === input.projectId);
  if (forProject.length > 0) return forProject.toSorted(byImportanceDesc);
  return notes
    .filter((entry) => belongsToProject(entry, input.projectId))
    .toSorted(byImportanceDesc);
}

function collectAlways(store: BrainStore, input: BrainSelectionInput): AlwaysGroups {
  return {
    identity: store.list({ kind: 'identity', limit: CANDIDATE_LIMIT }).toSorted(byImportanceDesc),
    rules: store
      .list({ kind: 'rule', limit: CANDIDATE_LIMIT })
      .filter((entry) => ruleApplies(entry, input.mode))
      .toSorted(byImportanceDesc),
    preferences: store
      .list({ kind: 'preference', limit: CANDIDATE_LIMIT })
      .filter((entry) => belongsToProject(entry, input.projectId))
      .toSorted(byImportanceDesc),
    project: store
      .list({ kind: 'project', limit: CANDIDATE_LIMIT })
      .filter((entry) => entry.projectId === input.projectId)
      .toSorted(byImportanceDesc),
    notes: workingNotes(store, input),
  };
}

/**
 * Fits the always block into its budget. Rules are pinned; everything else is
 * droppable in this order: preferences, working notes, project entries, identity.
 * Each group drops its lowest-importance entry first.
 */
function fitAlways(groups: AlwaysGroups): BrainEntry[] {
  const dropped = new Set<string>();
  const ordered = (): BrainEntry[] =>
    [
      ...groups.identity,
      ...groups.rules,
      ...groups.preferences,
      ...groups.project,
      ...groups.notes,
    ].filter((entry) => !dropped.has(entry.id));

  const dropOrder = [
    ...[...groups.preferences].toSorted(byImportanceAsc),
    ...[...groups.notes].toSorted(byImportanceAsc),
    ...[...groups.project].toSorted(byImportanceAsc),
    ...[...groups.identity].toSorted(byImportanceAsc),
  ];

  let tokens = brainTokens(ordered());
  for (const candidate of dropOrder) {
    if (tokens <= ALWAYS_TOKEN_BUDGET) break;
    dropped.add(candidate.id);
    tokens = brainTokens(ordered());
  }
  return ordered();
}

export interface ScoredBrainEntry {
  entry: BrainEntry;
  score: number;
  /** Query terms found in the entry text or tags. */
  matchedTerms: string[];
  /** Recency component in 0..1, already part of `score`. */
  recency: number;
}

/**
 * Ranks retrieval candidates with the selector's own score. `memory.search` reuses
 * this so a tool call ranks exactly like the next turn would.
 */
export function scoreBrainCandidates(
  store: BrainStore,
  input: { projectId: string | undefined; query: string; now?: Date },
): ScoredBrainEntry[] {
  const terms = termsOf(input.query);
  if (terms.length === 0) return [];
  const now = input.now ?? new Date();
  const seen = new Set<string>();
  const scored: ScoredBrainEntry[] = [];
  for (const entry of store.list({ query: input.query, limit: CANDIDATE_LIMIT })) {
    if (seen.has(entry.id)) continue;
    if (entry.kind === 'rule' || entry.kind === 'identity') continue;
    if (!belongsToProject(entry, input.projectId)) continue;
    seen.add(entry.id);
    const haystack = `${entry.text} ${entry.tags}`.toLowerCase();
    const recency = recencyScore(entry, now);
    scored.push({
      entry,
      score: 0.5 * matchScore(entry, terms) + 0.3 * entry.importance + 0.2 * recency,
      matchedTerms: terms.filter((term) => haystack.includes(term)),
      recency,
    });
  }
  return scored.toSorted(
    (a, b) =>
      b.score - a.score ||
      b.entry.updatedAt.localeCompare(a.entry.updatedAt) ||
      a.entry.id.localeCompare(b.entry.id),
  );
}

function collectRetrieval(
  store: BrainStore,
  input: BrainSelectionInput,
  excluded: ReadonlySet<string>,
): BrainEntry[] {
  if (termsOf(input.message).length === 0 || input.retrieval === false) return [];

  const ranked = scoreBrainCandidates(store, {
    projectId: input.projectId,
    query: input.message,
    ...(input.now === undefined ? {} : { now: input.now }),
  }).filter((candidate) => !excluded.has(candidate.entry.id));

  const selected: BrainEntry[] = [];
  for (const { entry } of ranked) {
    if (selected.length >= RETRIEVAL_MAX_ENTRIES) break;
    if (brainTokens([...selected, entry]) > RETRIEVAL_TOKEN_BUDGET) continue;
    selected.push(entry);
  }
  return selected;
}

/** Selects exactly what the next turn injects, without touching usage counters. */
export function selectBrain(store: BrainStore, input: BrainSelectionInput): BrainSelection {
  const always = fitAlways(collectAlways(store, input));
  const excluded = new Set(always.map((entry) => entry.id));
  const retrieved = collectRetrieval(store, input, excluded);
  const text = renderBrainEntries([...always, ...retrieved]);
  return {
    slice: { always, retrieved, tokens: estimateTokens(text) },
    text,
  };
}

/** Marks every entry in a slice as injected. The runner calls this after a send. */
export function recordInjection(store: BrainStore, slice: BrainSlice, at: Date = new Date()): void {
  const ids = [...slice.always, ...slice.retrieved].map((entry) => entry.id);
  if (ids.length === 0) return;
  store.touch(ids, at.toISOString());
}
