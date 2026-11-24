import type { DatabaseSync } from 'node:sqlite';
import { asRow, json, nullableText, text, type SqlRow } from '../rows.js';

export type TurnStatus = 'running' | 'needs-approval' | 'complete' | 'interrupted' | 'failed';

export interface TurnRecord {
  id: string;
  threadId: string;
  status: TurnStatus;
  injectedIds: string[];
  createdAt: string;
  finishedAt: string | null;
}

export interface CreateTurnInput {
  id: string;
  threadId: string;
  status: TurnStatus;
  injectedIds: string[];
  createdAt: string;
}

export interface TurnsRepo {
  create(input: CreateTurnInput): TurnRecord;
  get(id: string): TurnRecord | undefined;
  setStatus(id: string, status: TurnStatus): TurnRecord | undefined;
  finish(id: string, status: TurnStatus, finishedAt: string): TurnRecord | undefined;
  listActive(): TurnRecord[];
}

const TURN_COLUMNS = 'id, thread_id, status, injected_ids, created_at, finished_at';

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('column injected_ids is not an array');
  return value.filter((item): item is string => typeof item === 'string');
}

function mapTurn(row: SqlRow): TurnRecord {
  return {
    id: text(row, 'id'),
    threadId: text(row, 'thread_id'),
    status: text(row, 'status') as TurnStatus,
    injectedIds: stringList(json(row, 'injected_ids')),
    createdAt: text(row, 'created_at'),
    finishedAt: nullableText(row, 'finished_at'),
  };
}

export function createTurnsRepo(db: DatabaseSync): TurnsRepo {
  const insert = db.prepare(
    'INSERT INTO turns (id, thread_id, status, injected_ids, created_at, finished_at) VALUES (?, ?, ?, ?, ?, NULL)',
  );
  const selectOne = db.prepare(`SELECT ${TURN_COLUMNS} FROM turns WHERE id = ?`);
  const updateStatus = db.prepare('UPDATE turns SET status = ? WHERE id = ?');
  const finishRow = db.prepare('UPDATE turns SET status = ?, finished_at = ? WHERE id = ?');
  const selectActive = db.prepare(
    `SELECT ${TURN_COLUMNS} FROM turns WHERE status IN ('running','needs-approval') ORDER BY created_at ASC, rowid ASC`,
  );

  function get(id: string): TurnRecord | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapTurn(asRow(row));
  }

  return {
    create: (input) => {
      insert.run(
        input.id,
        input.threadId,
        input.status,
        JSON.stringify(input.injectedIds),
        input.createdAt,
      );
      const created = get(input.id);
      if (created === undefined) throw new Error('turn insert did not persist');
      return created;
    },
    get,
    setStatus: (id, status) => {
      updateStatus.run(status, id);
      return get(id);
    },
    finish: (id, status, finishedAt) => {
      finishRow.run(status, finishedAt, id);
      return get(id);
    },
    listActive: () => selectActive.all().map((row) => mapTurn(asRow(row))),
  };
}
