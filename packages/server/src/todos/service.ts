import type { TodoList, TodoPhase, TodoStatus } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import type { EventBus } from '../events.js';

/**
 * The per-thread task list behind the `todo` tool, modelled on OMP's todo tool: one
 * operation per call, phases of tasks, exactly one task in progress, and a text summary
 * the model reads back. Every mutation persists the whole list and emits
 * `todo.updated` so the UI re-renders live.
 */
export const TODO_OPS = ['init', 'start', 'done', 'drop', 'rm', 'append', 'view'] as const;
export type TodoOpName = (typeof TODO_OPS)[number];

export const TODO_LIMITS = { phases: 12, tasksPerPhase: 40, taskChars: 500, phaseChars: 80 } as const;
export const DEFAULT_PHASE = 'Tasks';

export interface TodoOp {
  op: TodoOpName;
  /** init: the full replacement list. */
  list?: { phase?: string; items: string[] }[];
  /** append, or a flat init. */
  items?: string[];
  task?: string;
  phase?: string;
}

export interface TodoResult {
  phases: TodoPhase[];
  summary: string;
  /** Set when the op was refused; the stored list is unchanged. */
  error?: string;
}

export interface TodoService {
  get(threadId: string): TodoList;
  apply(threadId: string, op: TodoOp): TodoResult;
  /** Parses raw tool arguments (JSON strings for list and items) and applies them. */
  applyToolCall(threadId: string, args: Record<string, unknown>): string;
}

class TodoError extends Error {}

function clone(phases: readonly TodoPhase[]): TodoPhase[] {
  return phases.map((phase) => ({ name: phase.name, tasks: phase.tasks.map((task) => ({ ...task })) }));
}

function cleanTask(raw: unknown): string {
  if (typeof raw !== 'string') throw new TodoError('every task must be a string');
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length === 0) throw new TodoError('a task cannot be empty');
  if (text.length > TODO_LIMITS.taskChars) {
    throw new TodoError(`a task is limited to ${TODO_LIMITS.taskChars} characters`);
  }
  return text;
}

function cleanPhase(raw: string | undefined): string {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length === 0) return DEFAULT_PHASE;
  if (name.length > TODO_LIMITS.phaseChars) {
    throw new TodoError(`a phase name is limited to ${TODO_LIMITS.phaseChars} characters`);
  }
  return name;
}

function pendingTasks(items: readonly unknown[]): TodoPhase['tasks'] {
  if (items.length > TODO_LIMITS.tasksPerPhase) {
    throw new TodoError(`a phase holds at most ${TODO_LIMITS.tasksPerPhase} tasks`);
  }
  return items.map((item) => ({ content: cleanTask(item), status: 'pending' as TodoStatus }));
}

function findTask(phases: TodoPhase[], content: string): { phase: TodoPhase; index: number } {
  const wanted = content.replace(/\s+/g, ' ').trim();
  for (const phase of phases) {
    const index = phase.tasks.findIndex((task) => task.content === wanted);
    if (index >= 0) return { phase, index };
  }
  throw new TodoError(`no task named "${wanted}"`);
}

function findPhase(phases: TodoPhase[], name: string): TodoPhase {
  const phase = phases.find((entry) => entry.name === name.trim());
  if (phase === undefined) throw new TodoError(`no phase named "${name.trim()}"`);
  return phase;
}

/** The phase `append` picks when none is named: in progress, then first pending, then last. */
function appendTarget(phases: TodoPhase[]): TodoPhase | undefined {
  return (
    phases.find((phase) => phase.tasks.some((task) => task.status === 'in_progress')) ??
    phases.find((phase) => phase.tasks.some((task) => task.status === 'pending')) ??
    phases.at(-1)
  );
}

function setStatus(
  phases: TodoPhase[],
  op: TodoOp,
  status: Extract<TodoStatus, 'completed' | 'abandoned'>,
): void {
  if (op.task !== undefined) {
    const { phase, index } = findTask(phases, op.task);
    phase.tasks[index] = { ...phase.tasks[index]!, status };
    return;
  }
  const targets = op.phase !== undefined ? [findPhase(phases, op.phase)] : phases;
  for (const phase of targets) {
    phase.tasks = phase.tasks.map((task) => ({ ...task, status }));
  }
}

function remove(phases: TodoPhase[], op: TodoOp): TodoPhase[] {
  if (op.task !== undefined) {
    const { phase, index } = findTask(phases, op.task);
    phase.tasks.splice(index, 1);
    return phases;
  }
  if (op.phase !== undefined) {
    findPhase(phases, op.phase).tasks = [];
    return phases;
  }
  return [];
}

/** Applies one op to a copy; throws TodoError with the stored list untouched. */
export function applyTodoOp(current: readonly TodoPhase[], op: TodoOp): TodoPhase[] {
  const phases = clone(current);
  switch (op.op) {
    case 'view':
      return phases;
    case 'init': {
      let next: TodoPhase[];
      if (op.list !== undefined) {
        next = op.list.map((entry) => ({ name: cleanPhase(entry.phase), tasks: pendingTasks(entry.items) }));
      } else if (op.items !== undefined) {
        next = [{ name: cleanPhase(op.phase), tasks: pendingTasks(op.items) }];
      } else {
        throw new TodoError('init needs list or items');
      }
      if (next.length > TODO_LIMITS.phases) {
        throw new TodoError(`a list holds at most ${TODO_LIMITS.phases} phases`);
      }
      const names = new Set<string>();
      for (const phase of next) {
        if (names.has(phase.name)) throw new TodoError(`duplicate phase "${phase.name}"`);
        names.add(phase.name);
      }
      return next;
    }
    case 'start': {
      if (op.task === undefined) throw new TodoError('start needs task');
      const { phase, index } = findTask(phases, op.task);
      for (const entry of phases) {
        entry.tasks = entry.tasks.map((task) =>
          task.status === 'in_progress' ? { ...task, status: 'pending' } : task,
        );
      }
      phase.tasks[index] = { ...phase.tasks[index]!, status: 'in_progress' };
      return phases;
    }
    case 'done':
      setStatus(phases, op, 'completed');
      return phases;
    case 'drop':
      setStatus(phases, op, 'abandoned');
      return phases;
    case 'rm':
      return remove(phases, op);
    case 'append': {
      if (op.items === undefined || op.items.length === 0) throw new TodoError('append needs items');
      let target: TodoPhase | undefined;
      if (op.phase !== undefined) {
        const name = cleanPhase(op.phase);
        target = phases.find((phase) => phase.name === name);
        if (target === undefined) {
          if (phases.length >= TODO_LIMITS.phases) {
            throw new TodoError(`a list holds at most ${TODO_LIMITS.phases} phases`);
          }
          target = { name, tasks: [] };
          phases.push(target);
        }
      } else {
        target = appendTarget(phases);
        if (target === undefined) {
          target = { name: DEFAULT_PHASE, tasks: [] };
          phases.push(target);
        }
      }
      const added = pendingTasks(op.items);
      if (target.tasks.length + added.length > TODO_LIMITS.tasksPerPhase) {
        throw new TodoError(`a phase holds at most ${TODO_LIMITS.tasksPerPhase} tasks`);
      }
      target.tasks.push(...added);
      return phases;
    }
  }
}

const MARK: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[>]',
  completed: '[x]',
  abandoned: '[-]',
};

/** Remaining count, the current phase's progress, then the tree. */
export function formatTodoSummary(phases: readonly TodoPhase[], viewOnly = false): string {
  const tasks = phases.flatMap((phase) => phase.tasks);
  if (tasks.length === 0) return viewOnly ? 'Todo list is empty.' : 'Todo list cleared.';
  const open = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');
  const current =
    phases.find((phase) => phase.tasks.some((task) => task.status === 'in_progress')) ??
    phases.find((phase) => phase.tasks.some((task) => task.status === 'pending'));
  const lines = [`${open.length} of ${tasks.length} tasks remaining.`];
  if (current !== undefined) {
    const finished = current.tasks.filter(
      (task) => task.status === 'completed' || task.status === 'abandoned',
    ).length;
    lines.push(`Current phase: ${current.name} ${finished}/${current.tasks.length}`);
  }
  for (const phase of phases) {
    lines.push(`${phase.name}`);
    for (const task of phase.tasks) lines.push(`  ${MARK[task.status]} ${task.content}`);
  }
  return lines.join('\n');
}

function jsonArray(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new TodoError(`${field} must be a JSON array`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TodoError(`${field} must be a JSON array`);
  }
  if (!Array.isArray(parsed)) throw new TodoError(`${field} must be a JSON array`);
  return parsed;
}

function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Tool arguments to an op; an omitted op is inferred only from an unambiguous payload. */
export function parseTodoArgs(args: Record<string, unknown>, hasPhases: boolean): TodoOp {
  let op = typeof args.op === 'string' ? args.op : '';
  const phase = optionalText(args, 'phase');
  if (op.length === 0) {
    if (args.list !== undefined) op = 'init';
    else if (args.items !== undefined && phase !== undefined) op = 'append';
    else if (args.items !== undefined && !hasPhases) op = 'init';
    else throw new TodoError('op is required');
  }
  if (!(TODO_OPS as readonly string[]).includes(op)) {
    throw new TodoError(`unknown op "${op}"; use one of ${TODO_OPS.join(', ')}`);
  }
  const parsed: TodoOp = { op: op as TodoOpName };
  const task = optionalText(args, 'task');
  if (task !== undefined) parsed.task = task;
  if (phase !== undefined) parsed.phase = phase;
  if (args.items !== undefined) parsed.items = jsonArray(args.items, 'items').map((item) => cleanTask(item));
  if (args.list !== undefined) {
    parsed.list = jsonArray(args.list, 'list').map((entry) => {
      if (typeof entry !== 'object' || entry === null || !('items' in entry)) {
        throw new TodoError('each list entry needs phase and items');
      }
      const record = entry as { phase?: unknown; name?: unknown; items: unknown };
      const name = typeof record.phase === 'string' ? record.phase : typeof record.name === 'string' ? record.name : undefined;
      return {
        ...(name === undefined ? {} : { phase: name }),
        items: jsonArray(record.items, 'items').map((item) => cleanTask(item)),
      };
    });
  }
  return parsed;
}

export function createTodoService(deps: { repos: Repos; bus?: EventBus; now?: () => string }): TodoService {
  const now = deps.now ?? (() => new Date().toISOString());

  function read(threadId: string): TodoPhase[] {
    return deps.repos.todos.get(threadId)?.phases ?? [];
  }

  function apply(threadId: string, op: TodoOp): TodoResult {
    const current = read(threadId);
    let next: TodoPhase[];
    try {
      next = applyTodoOp(current, op);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { phases: current, summary: `Errors: ${message}\n${formatTodoSummary(current, true)}`, error: message };
    }
    if (op.op !== 'view') {
      deps.repos.todos.set(threadId, next, now());
      deps.bus?.emit({
        kind: 'event',
        type: 'todo.updated',
        threadId,
        payload: { threadId, phases: next },
      });
    }
    return { phases: next, summary: formatTodoSummary(next, op.op === 'view') };
  }

  return {
    get(threadId) {
      const record = deps.repos.todos.get(threadId);
      return { threadId, phases: record?.phases ?? [], updatedAt: record?.updatedAt ?? null };
    },
    apply,
    applyToolCall(threadId, args) {
      let op: TodoOp;
      try {
        op = parseTodoArgs(args, read(threadId).length > 0);
      } catch (error) {
        return `Invalid todo arguments: ${error instanceof Error ? error.message : String(error)}`;
      }
      return apply(threadId, op).summary;
    },
  };
}
