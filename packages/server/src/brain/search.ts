import type { BrainKind } from '@tuffcode/contracts';
import { badRequest } from '../errors.js';
import {
  RETRIEVAL_MAX_ENTRIES,
  RETRIEVAL_TOKEN_BUDGET,
  brainTokens,
  scoreBrainCandidates,
  type ScoredBrainEntry,
} from './selector.js';
import type { BrainStore } from './store.js';

/**
 * The agent-facing memory search, spec section 15.8. It runs the selector's own
 * retrieval scoring and then applies the same entry cap and token budget, so what
 * the tool reports is what the next turn would inject. Nothing is recorded: no
 * `use_count` bump, no `last_used_at` write.
 */
export interface MemorySearchInput {
  projectId?: string;
  query: string;
  limit?: number;
  now?: Date;
}

export interface MemorySearchEntry {
  id: string;
  kind: BrainKind;
  text: string;
  score: number;
  reason: string;
}

export interface MemorySearchResult {
  entries: MemorySearchEntry[];
}

function reasonFor(candidate: ScoredBrainEntry): string {
  const matched =
    candidate.matchedTerms.length === 0
      ? 'no matched terms'
      : `matched ${candidate.matchedTerms.map((term) => `"${term}"`).join(', ')}`;
  const scope = candidate.entry.projectId === null ? 'global scope' : 'project scope';
  return `${matched}; importance ${candidate.entry.importance.toFixed(2)}; recency ${candidate.recency.toFixed(2)}; ${scope}`;
}

export function searchMemory(store: BrainStore, input: MemorySearchInput): MemorySearchResult {
  const query = input.query.trim();
  if (query.length === 0) throw badRequest('query must not be empty');

  const limit = Math.max(1, Math.min(input.limit ?? RETRIEVAL_MAX_ENTRIES, RETRIEVAL_MAX_ENTRIES));
  const ranked = scoreBrainCandidates(store, {
    projectId: input.projectId,
    query,
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  const selected: ScoredBrainEntry[] = [];
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    const entries = [...selected.map((picked) => picked.entry), candidate.entry];
    if (brainTokens(entries) > RETRIEVAL_TOKEN_BUDGET) continue;
    selected.push(candidate);
  }

  return {
    entries: selected.map((candidate) => ({
      id: candidate.entry.id,
      kind: candidate.entry.kind,
      text: candidate.entry.text,
      score: candidate.score,
      reason: reasonFor(candidate),
    })),
  };
}
