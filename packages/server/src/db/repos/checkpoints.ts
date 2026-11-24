import type { DatabaseSync } from 'node:sqlite';
import type { Checkpoint } from '@tuffcode/contracts';
import { asRow, text, type SqlRow } from '../rows.js';

export interface CreateCheckpointInput {
  id: string;
  threadId: string;
  ref: string;
  label: string;
  commitSha: string;
  createdAt: string;
}

export interface CheckpointsRepo {
  create(input: CreateCheckpointInput): Checkpoint;
  get(id: string): Checkpoint | undefined;
  list(threadId: string): Checkpoint[];
  remove(id: string): void;
}

const CHECKPOINT_COLUMNS = 'id, thread_id, ref, label, commit_sha, created_at';

function mapCheckpoint(row: SqlRow): Checkpoint {
  return {
    id: text(row, 'id'),
    threadId: text(row, 'thread_id'),
    ref: text(row, 'ref'),
    label: text(row, 'label'),
    commitSha: text(row, 'commit_sha'),
    createdAt: text(row, 'created_at'),
  };
}

export function createCheckpointsRepo(db: DatabaseSync): CheckpointsRepo {
  const insert = db.prepare(
    'INSERT INTO checkpoints (id, thread_id, ref, label, commit_sha, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const selectOne = db.prepare(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE id = ?`);
  const selectByThread = db.prepare(
    `SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC`,
  );
  const removeRow = db.prepare('DELETE FROM checkpoints WHERE id = ?');

  return {
    create: (input) => {
      insert.run(
        input.id,
        input.threadId,
        input.ref,
        input.label,
        input.commitSha,
        input.createdAt,
      );
      const row = selectOne.get(input.id);
      if (row === undefined) throw new Error('checkpoint insert did not persist');
      return mapCheckpoint(asRow(row));
    },
    get: (id) => {
      const row = selectOne.get(id);
      return row === undefined ? undefined : mapCheckpoint(asRow(row));
    },
    list: (threadId) => selectByThread.all(threadId).map((row) => mapCheckpoint(asRow(row))),
    remove: (id) => {
      removeRow.run(id);
    },
  };
}
