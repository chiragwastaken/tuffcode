import type { DatabaseSync } from 'node:sqlite';
import type { SubagentStatus, SubagentType, SubagentView } from '@tuffcode/contracts';
import { asRow, integer, nullableText, text, type SqlRow } from '../rows.js';

export interface CreateSubagentInput {
  childId: string;
  threadId: string;
  type: SubagentType;
  providerId: string;
  model: string;
  status: SubagentStatus;
  task: string;
  budgetTokens?: number | null;
  createdAt: string;
}

export interface SubagentRecord extends SubagentView {
  childThreadId: string | null;
  budgetTokens: number | null;
}

export interface FinishSubagentInput {
  status: SubagentStatus;
  summary?: string | null;
  updatedAt: string;
}

export interface SubagentsRepo {
  create(input: CreateSubagentInput): SubagentRecord;
  get(childId: string): SubagentRecord | undefined;
  listByThread(threadId: string): SubagentRecord[];
  listAll(): SubagentRecord[];
  setRunning(
    childId: string,
    childThreadId: string | null,
    updatedAt: string,
  ): SubagentRecord | undefined;
  finish(childId: string, input: FinishSubagentInput): SubagentRecord | undefined;
  /** Startup recovery: queued and running rows can never resume after a restart. */
  failUnfinished(updatedAt: string, summary: string): number;
}

const COLUMNS =
  'child_id, thread_id, child_thread_id, type, provider_id, model, status, task, summary, budget_tokens, created_at, updated_at';

function mapRecord(row: SqlRow): SubagentRecord {
  return {
    childId: text(row, 'child_id'),
    threadId: text(row, 'thread_id'),
    type: text(row, 'type') as SubagentType,
    providerId: text(row, 'provider_id'),
    model: text(row, 'model'),
    status: text(row, 'status') as SubagentStatus,
    task: text(row, 'task'),
    summary: nullableText(row, 'summary') ?? undefined,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    childThreadId: nullableText(row, 'child_thread_id'),
    budgetTokens: row['budget_tokens'] === null ? null : integer(row, 'budget_tokens'),
  };
}

/** The contract view hides the internal child thread and budget columns. */
export function toSubagentView(record: SubagentRecord): SubagentView {
  return {
    childId: record.childId,
    threadId: record.threadId,
    type: record.type,
    model: record.model,
    providerId: record.providerId,
    status: record.status,
    task: record.task,
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createSubagentsRepo(db: DatabaseSync): SubagentsRepo {
  const insert = db.prepare(
    `INSERT INTO subagents (${COLUMNS}) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  );
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM subagents WHERE child_id = ?`);
  const selectByThread = db.prepare(
    `SELECT ${COLUMNS} FROM subagents WHERE thread_id = ? ORDER BY created_at ASC`,
  );
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM subagents ORDER BY created_at ASC`);
  const updateRunning = db.prepare(
    'UPDATE subagents SET status = ?, child_thread_id = ?, updated_at = ? WHERE child_id = ?',
  );
  const updateFinished = db.prepare(
    'UPDATE subagents SET status = ?, summary = COALESCE(?, summary), updated_at = ? WHERE child_id = ?',
  );
  const failUnfinished = db.prepare(
    "UPDATE subagents SET status = 'failed', summary = COALESCE(summary, ?), updated_at = ? WHERE status IN ('queued','running')",
  );

  function get(childId: string): SubagentRecord | undefined {
    const row = selectOne.get(childId);
    return row === undefined ? undefined : mapRecord(asRow(row));
  }

  return {
    create: (input) => {
      insert.run(
        input.childId,
        input.threadId,
        input.type,
        input.providerId,
        input.model,
        input.status,
        input.task,
        input.budgetTokens ?? null,
        input.createdAt,
        input.createdAt,
      );
      const created = get(input.childId);
      if (created === undefined) throw new Error('subagent insert did not persist');
      return created;
    },
    get,
    listByThread: (threadId) => selectByThread.all(threadId).map((row) => mapRecord(asRow(row))),
    listAll: () => selectAll.all().map((row) => mapRecord(asRow(row))),
    setRunning: (childId, childThreadId, updatedAt) => {
      updateRunning.run('running', childThreadId, updatedAt, childId);
      return get(childId);
    },
    finish: (childId, input) => {
      updateFinished.run(input.status, input.summary ?? null, input.updatedAt, childId);
      return get(childId);
    },
    failUnfinished: (updatedAt, summary) =>
      Number(failUnfinished.run(summary, updatedAt).changes ?? 0),
  };
}
