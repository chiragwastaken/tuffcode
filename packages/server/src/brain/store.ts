import type { BrainEntry } from '@tuffcode/contracts';
import type { BrainListOptions, BrainRepo, UpsertBrainInput } from '../db/repos/index.js';
import { removeEntryMirror, writeEntryMirror } from './mirror.js';

/**
 * The brain store is the mutation boundary: every write goes through the SQLite
 * repository and then refreshes the markdown mirror. Reads stay on the repository,
 * which already owns the FTS5 joins and the content-sync triggers.
 */
export interface BrainStore {
  list(options?: BrainListOptions): BrainEntry[];
  get(id: string): BrainEntry | undefined;
  upsert(input: UpsertBrainInput): BrainEntry;
  remove(id: string): void;
  /** Records an injection: bumps `use_count` and sets `last_used_at`. */
  touch(ids: readonly string[], at: string): void;
}

export function createBrainStore(repo: BrainRepo): BrainStore {
  return {
    list: (options = {}) => repo.list(options),
    get: (id) => repo.get(id),
    upsert: (input) => {
      const previous = input.id === undefined ? undefined : repo.get(input.id);
      const entry = repo.upsert(input);
      if (
        previous !== undefined &&
        (previous.kind !== entry.kind || previous.projectId !== entry.projectId)
      ) {
        removeEntryMirror(repo, previous);
      }
      writeEntryMirror(repo, entry);
      return entry;
    },
    remove: (id) => {
      const entry = repo.get(id);
      repo.remove(id);
      if (entry !== undefined) removeEntryMirror(repo, entry);
    },
    touch: (ids, at) => repo.touch([...ids], at),
  };
}
