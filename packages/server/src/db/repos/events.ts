import type { DatabaseSync } from 'node:sqlite';
import type { EventRow } from '@tuffcode/contracts';
import { transaction } from '../index.js';
import { asRow, integer, json, text, type SqlRow } from '../rows.js';

export interface EventsRepo {
  /** Appends one event and bumps `threads.last_seq` in the same transaction. */
  append(threadId: string, type: string, payload: unknown, createdAt?: string): number;
  /** Rows with `seq > sinceSeq`, oldest first, at most `limit`. */
  since(threadId: string, sinceSeq: number, limit: number): EventRow[];
  count(threadId: string): number;
}

const EVENT_COLUMNS = 'id, thread_id, seq, type, payload, created_at';

export function mapEvent(row: SqlRow): EventRow {
  return {
    id: integer(row, 'id'),
    threadId: text(row, 'thread_id'),
    seq: integer(row, 'seq'),
    type: text(row, 'type'),
    payload: json(row, 'payload'),
    createdAt: text(row, 'created_at'),
  };
}

export function createEventsRepo(db: DatabaseSync): EventsRepo {
  const selectLastSeq = db.prepare('SELECT last_seq FROM threads WHERE id = ?');
  const insertEvent = db.prepare(
    'INSERT INTO events (thread_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const bumpLastSeq = db.prepare('UPDATE threads SET last_seq = ? WHERE id = ?');
  const selectSince = db.prepare(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
  );
  const selectCount = db.prepare('SELECT COUNT(*) AS total FROM events WHERE thread_id = ?');

  return {
    append: (threadId, type, payload, createdAt = new Date().toISOString()) =>
      transaction(db, () => {
        const threadRow = selectLastSeq.get(threadId);
        if (threadRow === undefined) {
          throw new Error(`thread not found: ${threadId}`);
        }
        const lastSeq = integer(asRow(threadRow), 'last_seq');
        const seq = lastSeq + 1;
        insertEvent.run(threadId, seq, type, JSON.stringify(payload), createdAt);
        bumpLastSeq.run(seq, threadId);
        return seq;
      }),
    since: (threadId, sinceSeq, limit) =>
      selectSince
        .all(threadId, sinceSeq, Math.max(1, Math.floor(limit)))
        .map((row) => mapEvent(asRow(row))),
    count: (threadId) => {
      const row = selectCount.get(threadId);
      return row === undefined ? 0 : integer(asRow(row), 'total');
    },
  };
}
