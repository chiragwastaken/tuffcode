import { badRequest } from '../errors.js';
import { COUNCIL_CAPS } from './caps.js';
import type { CouncilPlan, PlanTask } from './types.js';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw badRequest(`${label} must be a string`);
  return value;
}

function asStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw badRequest(`${label} must be an array of strings`);
  return value.map((entry, index) => asString(entry, `${label}[${index}]`));
}

/** Normalizes an owned path for overlap comparison. */
function normalizeOwnedPath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/$/, '');
  return normalized.toLowerCase();
}

/**
 * Two ownership entries collide when they name the same path, or when one is a
 * directory that contains the other. `src/a.ts` and `src/a.tsx` stay distinct.
 */
export function pathsOverlap(left: string, right: string): boolean {
  const a = normalizeOwnedPath(left);
  const b = normalizeOwnedPath(right);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function assertAcyclic(tasks: readonly PlanTask[]): void {
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.title, task.dependsOn.length);
    edges.set(task.title, []);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      const list = edges.get(dependency);
      if (list !== undefined) list.push(task.title);
    }
  }
  const ready = tasks.filter((task) => indegree.get(task.title) === 0).map((task) => task.title);
  let visited = 0;
  while (ready.length > 0) {
    const title = ready.shift();
    if (title === undefined) break;
    visited += 1;
    for (const next of edges.get(title) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  if (visited !== tasks.length) {
    const stuck = tasks
      .filter((task) => (indegree.get(task.title) ?? 0) > 0)
      .map((task) => task.title);
    throw badRequest(`dependency cycle: ${stuck.join(' -> ')}`);
  }
}

/**
 * Validates a planner result against the rules the planner prompt states and the
 * caps the service enforces: unique titles, disjoint file ownership, known and
 * acyclic dependencies, 1 to 12 tasks. A planner question is only valid when it
 * asked for a decision instead of a plan.
 */
export function validatePlan(raw: unknown): CouncilPlan {
  const root = asRecord(raw, 'plan');
  const rawTasks = root['tasks'];
  if (!Array.isArray(rawTasks)) throw badRequest('plan.tasks must be an array');

  const rawQuestion = root['question'];
  let question: string | null = null;
  if (rawQuestion !== undefined && rawQuestion !== null) {
    question = asString(rawQuestion, 'plan.question').trim();
    if (question.length === 0) throw badRequest('plan.question must not be empty');
  }
  if (question !== null && rawTasks.length > 0) {
    throw badRequest('plan.question is only allowed when tasks is empty');
  }
  if (rawTasks.length > COUNCIL_CAPS.tasksPerGoal) {
    throw badRequest(`plan has ${rawTasks.length} tasks; the cap is ${COUNCIL_CAPS.tasksPerGoal}`);
  }
  if (rawTasks.length === 0) {
    if (question === null) throw badRequest('plan has no tasks and no question');
    return { tasks: [], question };
  }

  const tasks: PlanTask[] = rawTasks.map((value, index) => {
    const label = `plan.tasks[${index}]`;
    const task = asRecord(value, label);
    const title = asString(task['title'], `${label}.title`).trim();
    if (title.length === 0) throw badRequest(`${label}.title must not be empty`);
    const brief = asString(task['brief'], `${label}.brief`).trim();
    if (brief.length === 0) throw badRequest(`${label}.brief must not be empty`);

    const files = asStringList(task['files'], `${label}.files`)
      .map((file) => file.trim())
      .filter((file) => file.length > 0);
    if (files.length === 0) throw badRequest(`task "${title}" must own at least one file`);
    const uniqueFiles: string[] = [];
    for (const file of files) {
      if (uniqueFiles.some((existing) => pathsOverlap(existing, file))) continue;
      uniqueFiles.push(file);
    }

    const rawDependsOn = task['dependsOn'] ?? [];
    const dependsOn = asStringList(rawDependsOn, `${label}.dependsOn`)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const rawCritical = task['critical'] ?? false;
    if (typeof rawCritical !== 'boolean') {
      throw badRequest(`${label}.critical must be a boolean`);
    }

    return {
      title,
      files: uniqueFiles,
      dependsOn,
      critical: rawCritical,
      brief,
    };
  });

  const byTitle = new Map<string, PlanTask>();
  for (const task of tasks) {
    const key = task.title.toLowerCase();
    if (byTitle.has(key)) throw badRequest(`duplicate task title: "${task.title}"`);
    byTitle.set(key, task);
  }

  for (const task of tasks) {
    const canonical: string[] = [];
    for (const dependency of task.dependsOn) {
      const target = byTitle.get(dependency.toLowerCase());
      if (target === undefined) {
        throw badRequest(`task "${task.title}" depends on unknown task "${dependency}"`);
      }
      if (target.title === task.title) {
        throw badRequest(`task "${task.title}" depends on itself`);
      }
      if (!canonical.includes(target.title)) canonical.push(target.title);
    }
    task.dependsOn = canonical;
  }

  for (let left = 0; left < tasks.length; left += 1) {
    const first = tasks[left];
    if (first === undefined) continue;
    for (let right = left + 1; right < tasks.length; right += 1) {
      const second = tasks[right];
      if (second === undefined) continue;
      for (const owned of first.files) {
        for (const other of second.files) {
          if (!pathsOverlap(owned, other)) continue;
          throw badRequest(
            `file ownership overlaps between "${first.title}" and "${second.title}": ${owned} and ${other}`,
          );
        }
      }
    }
  }

  assertAcyclic(tasks);
  return { tasks, question: null };
}

/** Extracts the first JSON object from a planner reply and validates it. */
export function parsePlan(text: string): CouncilPlan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw badRequest('planner did not return a JSON object');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw badRequest('planner returned invalid JSON');
  }
  return validatePlan(raw);
}
