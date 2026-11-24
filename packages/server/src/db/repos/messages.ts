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
  list(threadId: string, limit?: number): Message[];
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
  const selectOne = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`);
  const selectByThread = db.prepare(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?`,
  );

  return {
    add: (input) => {
      insert.run(input.id, input.threadId, input.role, input.content, input.createdAt);
      const row = selectOne.get(input.id);
      if (row === undefined) throw new Error('message insert did not persist');
      return mapMessage(asRow(row));
    },
    list: (threadId, limit = 500) =>
      selectByThread
        .all(threadId, Math.max(1, Math.floor(limit)))
        .map((row) => mapMessage(asRow(row))),
  };
}
