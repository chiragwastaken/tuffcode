import type { DatabaseSync } from 'node:sqlite';
import { TodoPhaseSchema, type TodoPhase } from '@tuffcode/contracts';
import { asRow, json, text } from '../rows.js';

export interface TodoRecord {
  phases: TodoPhase[];
  updatedAt: string;
}

export interface TodosRepo {
  get(threadId: string): TodoRecord | undefined;
  set(threadId: string, phases: readonly TodoPhase[], updatedAt: string): void;
}

/** One row per thread; the phases column is the whole list as validated JSON. */
export function createTodosRepo(db: DatabaseSync): TodosRepo {
  const selectOne = db.prepare('SELECT phases, updated_at FROM todos WHERE thread_id = ?');
  const upsert = db.prepare(
    'INSERT INTO todos (thread_id, phases, updated_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET phases = excluded.phases, updated_at = excluded.updated_at',
  );

  return {
    get: (threadId) => {
      const raw = selectOne.get(threadId);
      if (raw === undefined) return undefined;
      const row = asRow(raw);
      const parsed = TodoPhaseSchema.array().safeParse(json(row, 'phases'));
      // A row that no longer validates reads as an empty list rather than failing the thread.
      return { phases: parsed.success ? parsed.data : [], updatedAt: text(row, 'updated_at') };
    },
    set: (threadId, phases, updatedAt) => {
      upsert.run(threadId, JSON.stringify(phases), updatedAt);
    },
  };
}
