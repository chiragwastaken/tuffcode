import type { DatabaseSync } from 'node:sqlite';
import type { Message, MessageRole } from '@tuffcode/contracts';
import { asRow, text, type SqlRow } from '../rows.js';

export interface AddMessageInput {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface MessagesRepo {
  add(input: AddMessageInput): Message;
  /**
   * Inserts unless a row with the same id already exists. Turn-derived message ids
   * make a replayed insert a no-op instead of a duplicate.
   */
  addIfAbsent(input: AddMessageInput): Message;
  list(threadId: string, limit?: number): Message[];
  /** Deletes every message of one thread; returns the number of rows removed. */
  removeByThread(threadId: string): number;
  /** Deletes the given message ids; returns the number of rows removed. */
  removeMany(ids: readonly string[]): number;
  /** Newest user and assistant messages containing `query`, case-insensitive, one per thread. */
  search(query: string, limit: number): Message[];
}

/** Escapes LIKE wildcards so the query matches literally; paired with `ESCAPE '\\'`. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const MESSAGE_COLUMNS = 'id, thread_id, role, content, created_at';

function mapMessage(row: SqlRow): Message {
  return {
    id: text(row, 'id'),
    threadId: text(row, 'thread_id'),
    role: text(row, 'role') as MessageRole,
    content: text(row, 'content'),
    createdAt: text(row, 'created_at'),
  };
}

export function createMessagesRepo(db: DatabaseSync): MessagesRepo {
  const insert = db.prepare(
    'INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertIgnore = db.prepare(
    'INSERT OR IGNORE INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const selectOne = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`);
  const selectByThread = db.prepare(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?`,
  );
  const deleteByThread = db.prepare('DELETE FROM messages WHERE thread_id = ?');
  const deleteOne = db.prepare('DELETE FROM messages WHERE id = ?');
  const searchRows = db.prepare(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE role IN ('user','assistant') AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  );

  function readBack(id: string): Message {
    const row = selectOne.get(id);
    if (row === undefined) throw new Error('message insert did not persist');
    return mapMessage(asRow(row));
  }

  return {
    add: (input) => {
      insert.run(input.id, input.threadId, input.role, input.content, input.createdAt);
      return readBack(input.id);
    },
    addIfAbsent: (input) => {
      insertIgnore.run(input.id, input.threadId, input.role, input.content, input.createdAt);
      return readBack(input.id);
    },
    list: (threadId, limit = 500) =>
      selectByThread
        .all(threadId, Math.max(1, Math.floor(limit)))
        .map((row) => mapMessage(asRow(row))),
    removeByThread: (threadId) => Number(deleteByThread.run(threadId).changes),
    removeMany: (ids) => {
      let removed = 0;
      for (const id of ids) removed += Number(deleteOne.run(id).changes);
      return removed;
    },
    search: (query, limit) => {
      const cap = Math.max(1, Math.min(50, Math.floor(limit)));
      const seen = new Set<string>();
      const out: Message[] = [];
      // Over-fetch so one chatty thread cannot crowd every other thread out of the result.
      for (const row of searchRows.all(likePattern(query), cap * 8)) {
        const message = mapMessage(asRow(row));
        if (seen.has(message.threadId)) continue;
        seen.add(message.threadId);
        out.push(message);
        if (out.length >= cap) break;
      }
      return out;
    },
  };
}
