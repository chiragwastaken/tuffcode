import type { DatabaseSync } from 'node:sqlite';
import type { Approval, ApprovalChoice, ApprovalDecision } from '@tuffcode/contracts';
import { asRow, json, nullableText, text, type SqlRow } from '../rows.js';

export interface CreateApprovalInput {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  createdAt: string;
}

export interface ApprovalsRepo {
  create(input: CreateApprovalInput): Approval;
  get(id: string): Approval | undefined;
  list(threadId: string): Approval[];
  listPending(threadId: string): Approval[];
  resolve(id: string, decision: ApprovalChoice, resolvedAt: string): Approval | undefined;
}

const APPROVAL_COLUMNS =
  'id, thread_id, tool_call_id, tool_name, input, decision, created_at, resolved_at';

function mapApproval(row: SqlRow): Approval {
  return {
    id: text(row, 'id'),
    threadId: text(row, 'thread_id'),
    toolCallId: text(row, 'tool_call_id'),
    toolName: text(row, 'tool_name'),
    input: json(row, 'input'),
    decision: text(row, 'decision') as ApprovalDecision,
    createdAt: text(row, 'created_at'),
    resolvedAt: nullableText(row, 'resolved_at'),
  };
}

export function createApprovalsRepo(db: DatabaseSync): ApprovalsRepo {
  const insert = db.prepare(
    'INSERT INTO approvals (id, thread_id, tool_call_id, tool_name, input, decision, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
  );
  const selectOne = db.prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`);
  const selectByThread = db.prepare(
    `SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const selectPending = db.prepare(
    `SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE thread_id = ? AND decision = 'pending' ORDER BY created_at ASC, rowid ASC`,
  );
  const updateDecision = db.prepare(
    'UPDATE approvals SET decision = ?, resolved_at = ? WHERE id = ?',
  );

  function get(id: string): Approval | undefined {
    const row = selectOne.get(id);
    return row === undefined ? undefined : mapApproval(asRow(row));
  }

  return {
    create: (input) => {
      insert.run(
        input.id,
        input.threadId,
        input.toolCallId,
        input.toolName,
        JSON.stringify(input.input),
        'pending',
        input.createdAt,
      );
      const created = get(input.id);
      if (created === undefined) throw new Error('approval insert did not persist');
      return created;
    },
    get,
    list: (threadId) => selectByThread.all(threadId).map((row) => mapApproval(asRow(row))),
    listPending: (threadId) => selectPending.all(threadId).map((row) => mapApproval(asRow(row))),
    resolve: (id, decision, resolvedAt) => {
      updateDecision.run(decision, resolvedAt, id);
      return get(id);
    },
  };
}
