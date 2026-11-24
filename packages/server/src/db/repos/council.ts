import type { DatabaseSync } from 'node:sqlite';
import type {
  Escalation,
  Goal,
  GoalAutonomy,
  GoalState,
  Review,
  ReviewVerdict,
  Task,
  TaskState,
} from '@tuffcode/contracts';
import { newId } from '@tuffcode/shared';
import { asRow, boolean, integer, nullableText, text, type SqlRow } from '../rows.js';

export interface CreateGoalInput {
  id?: string;
  threadId: string;
  text: string;
  autonomy: GoalAutonomy;
  state?: GoalState;
}

export interface CreateTaskInput {
  id?: string;
  goalId: string;
  threadId?: string | null;
  title: string;
  brief: string;
  state?: TaskState;
  authorProvider: string;
  authorModel: string;
  reviewerProvider?: string | null;
  reviewerModel?: string | null;
  critical?: boolean;
  round?: number;
  error?: string | null;
}

export interface TaskStatePatch {
  threadId?: string | null;
  reviewerProvider?: string | null;
  reviewerModel?: string | null;
  round?: number;
  error?: string | null;
}

export interface CreateReviewInput {
  id?: string;
  taskId: string;
  providerId: string;
  modelId: string;
  verdict: ReviewVerdict;
  body: string;
}

export interface CreateEscalationInput {
  id?: string;
  taskId: string;
  question: string;
}

export interface CouncilRepo {
  createGoal(input: CreateGoalInput): Goal;
  getGoal(id: string): Goal | undefined;
  listGoals(threadId?: string): Goal[];
  setGoalState(id: string, state: GoalState, reportedAt?: string | null): Goal | undefined;
  createTask(input: CreateTaskInput): Task;
  getTask(id: string): Task | undefined;
  listTasks(goalId: string): Task[];
  setTaskState(id: string, state: TaskState, patch?: TaskStatePatch): Task | undefined;
  createReview(input: CreateReviewInput): Review;
  listReviews(taskId: string): Review[];
  createEscalation(input: CreateEscalationInput): Escalation;
  listEscalations(taskId: string): Escalation[];
  resolveEscalation(id: string, answer: string, resolvedAt: string): Escalation | undefined;
}

const GOAL_COLUMNS = 'id, thread_id, text, autonomy, state, created_at, reported_at';
const TASK_COLUMNS =
  'id, goal_id, thread_id, title, brief, state, author_provider, author_model, reviewer_provider, reviewer_model, critical, round, error, created_at, updated_at';
const REVIEW_COLUMNS = 'id, task_id, provider_id, model_id, verdict, body, created_at';
const ESCALATION_COLUMNS = 'id, task_id, question, answer, created_at, resolved_at';

function mapGoal(row: SqlRow): Goal {
  return {
    id: text(row, 'id'),
    threadId: text(row, 'thread_id'),
    text: text(row, 'text'),
    autonomy: text(row, 'autonomy') as GoalAutonomy,
    state: text(row, 'state') as GoalState,
    createdAt: text(row, 'created_at'),
    reportedAt: nullableText(row, 'reported_at'),
  };
}

function mapTask(row: SqlRow): Task {
  return {
    id: text(row, 'id'),
    goalId: text(row, 'goal_id'),
    threadId: nullableText(row, 'thread_id'),
    title: text(row, 'title'),
    brief: text(row, 'brief'),
    state: text(row, 'state') as TaskState,
    authorProvider: text(row, 'author_provider'),
    authorModel: text(row, 'author_model'),
    reviewerProvider: nullableText(row, 'reviewer_provider'),
    reviewerModel: nullableText(row, 'reviewer_model'),
    critical: boolean(row, 'critical'),
    round: integer(row, 'round'),
    error: nullableText(row, 'error'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function mapReview(row: SqlRow): Review {
  return {
    id: text(row, 'id'),
    taskId: text(row, 'task_id'),
    providerId: text(row, 'provider_id'),
    modelId: text(row, 'model_id'),
    verdict: text(row, 'verdict') as ReviewVerdict,
    body: text(row, 'body'),
    createdAt: text(row, 'created_at'),
  };
}

function mapEscalation(row: SqlRow): Escalation {
  return {
    id: text(row, 'id'),
    taskId: text(row, 'task_id'),
    question: text(row, 'question'),
    answer: nullableText(row, 'answer'),
    createdAt: text(row, 'created_at'),
    resolvedAt: nullableText(row, 'resolved_at'),
  };
}

export function createCouncilRepo(db: DatabaseSync): CouncilRepo {
  const selectGoal = db.prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ?`);
  const selectGoals = db.prepare(
    `SELECT ${GOAL_COLUMNS} FROM goals ORDER BY created_at ASC, rowid ASC`,
  );
  const selectGoalsByThread = db.prepare(
    `SELECT ${GOAL_COLUMNS} FROM goals WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const insertGoal = db.prepare(
    'INSERT INTO goals (id, thread_id, text, autonomy, state, created_at, reported_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
  );
  const updateGoalState = db.prepare(
    'UPDATE goals SET state = ?, reported_at = COALESCE(?, reported_at) WHERE id = ?',
  );

  const selectTask = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`);
  const selectTasksByGoal = db.prepare(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE goal_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, goal_id, thread_id, title, brief, state, author_provider, author_model, reviewer_provider, reviewer_model, critical, round, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateTaskState = db.prepare(
    `UPDATE tasks SET state = ?,
       thread_id = COALESCE(?, thread_id),
       reviewer_provider = COALESCE(?, reviewer_provider),
       reviewer_model = COALESCE(?, reviewer_model),
       round = COALESCE(?, round),
       error = COALESCE(?, error),
       updated_at = ?
     WHERE id = ?`,
  );

  const selectReview = db.prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews WHERE id = ?`);
  const selectReviewsByTask = db.prepare(
    `SELECT ${REVIEW_COLUMNS} FROM reviews WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const insertReview = db.prepare(
    'INSERT INTO reviews (id, task_id, provider_id, model_id, verdict, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  const selectEscalation = db.prepare(`SELECT ${ESCALATION_COLUMNS} FROM escalations WHERE id = ?`);
  const selectEscalationsByTask = db.prepare(
    `SELECT ${ESCALATION_COLUMNS} FROM escalations WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`,
  );
  const insertEscalation = db.prepare(
    'INSERT INTO escalations (id, task_id, question, answer, created_at, resolved_at) VALUES (?, ?, ?, NULL, ?, NULL)',
  );
  const updateEscalation = db.prepare(
    'UPDATE escalations SET answer = ?, resolved_at = ? WHERE id = ?',
  );

  function getGoal(id: string): Goal | undefined {
    const row = selectGoal.get(id);
    return row === undefined ? undefined : mapGoal(asRow(row));
  }

  function getTask(id: string): Task | undefined {
    const row = selectTask.get(id);
    return row === undefined ? undefined : mapTask(asRow(row));
  }

  function getEscalation(id: string): Escalation | undefined {
    const row = selectEscalation.get(id);
    return row === undefined ? undefined : mapEscalation(asRow(row));
  }

  return {
    createGoal: (input) => {
      const id = input.id ?? newId('gol');
      insertGoal.run(
        id,
        input.threadId,
        input.text,
        input.autonomy,
        input.state ?? 'intake',
        new Date().toISOString(),
      );
      const goal = getGoal(id);
      if (goal === undefined) throw new Error('goal insert did not persist');
      return goal;
    },
    getGoal,
    listGoals: (threadId) =>
      (threadId === undefined ? selectGoals.all() : selectGoalsByThread.all(threadId)).map((row) =>
        mapGoal(asRow(row)),
      ),
    setGoalState: (id, state, reportedAt = null) => {
      updateGoalState.run(state, reportedAt, id);
      return getGoal(id);
    },
    createTask: (input) => {
      const id = input.id ?? newId('tsk');
      const now = new Date().toISOString();
      insertTask.run(
        id,
        input.goalId,
        input.threadId ?? null,
        input.title,
        input.brief,
        input.state ?? 'queued',
        input.authorProvider,
        input.authorModel,
        input.reviewerProvider ?? null,
        input.reviewerModel ?? null,
        input.critical === true ? 1 : 0,
        input.round ?? 0,
        input.error ?? null,
        now,
        now,
      );
      const task = getTask(id);
      if (task === undefined) throw new Error('task insert did not persist');
      return task;
    },
    getTask,
    listTasks: (goalId) => selectTasksByGoal.all(goalId).map((row) => mapTask(asRow(row))),
    setTaskState: (id, state, patch = {}) => {
      updateTaskState.run(
        state,
        patch.threadId ?? null,
        patch.reviewerProvider ?? null,
        patch.reviewerModel ?? null,
        patch.round ?? null,
        patch.error ?? null,
        new Date().toISOString(),
        id,
      );
      return getTask(id);
    },
    createReview: (input) => {
      const id = input.id ?? newId('rev');
      insertReview.run(
        id,
        input.taskId,
        input.providerId,
        input.modelId,
        input.verdict,
        input.body,
        new Date().toISOString(),
      );
      const row = selectReview.get(id);
      if (row === undefined) throw new Error('review insert did not persist');
      return mapReview(asRow(row));
    },
    listReviews: (taskId) => selectReviewsByTask.all(taskId).map((row) => mapReview(asRow(row))),
    createEscalation: (input) => {
      const id = input.id ?? newId('esc');
      insertEscalation.run(id, input.taskId, input.question, new Date().toISOString());
      const escalation = getEscalation(id);
      if (escalation === undefined) throw new Error('escalation insert did not persist');
      return escalation;
    },
    listEscalations: (taskId) =>
      selectEscalationsByTask.all(taskId).map((row) => mapEscalation(asRow(row))),
    resolveEscalation: (id, answer, resolvedAt) => {
      updateEscalation.run(answer, resolvedAt, id);
      return getEscalation(id);
    },
  };
}
