import type {
  Goal,
  GoalState,
  Review,
  ReviewVerdict,
  RpcResult,
  Task,
  TaskState,
} from '@tuffcode/contracts';
import {
  GOAL_STATE_LABEL,
  GOAL_STATE_TONE,
  REVIEW_VERDICT_LABEL,
  REVIEW_VERDICT_TONE,
  TASK_STATE_LABEL,
  TASK_STATE_TONE,
  type CouncilTone,
} from '../inspector/council-model';

/**
 * Deterministic layered layout for the council board, decision D36.
 *
 * Columns are dependency depth: tasks with no unmet dependency sit in column 0,
 * a task sits one column right of its deepest dependency. Rows inside a column are
 * ordered by title, then id, so the same goal always draws the same picture no
 * matter what order `council.status` returns rows in. No dependency and no
 * randomness, which is what makes it testable without a browser.
 */

export const PLANNER_WIDTH = 172;
export const PLANNER_HEIGHT = 52;
export const TASK_WIDTH = 180;
export const TASK_HEIGHT = 56;
export const REVIEWER_HEIGHT = 36;
export const REPORT_WIDTH = 172;
export const REPORT_HEIGHT = 52;

/** Space between the task card and the reviewer chip attached under it. */
const REVIEWER_GAP = 6;
const COLUMN_GAP = 64;
const ROW_GAP = 18;
const PADDING = 24;
/** The planner row sits this far above the first task row. */
const PLANNER_GAP = ROW_GAP * 2;

const COLUMN_STEP = TASK_WIDTH + COLUMN_GAP;
const ROW_STEP = TASK_HEIGHT + REVIEWER_GAP + REVIEWER_HEIGHT + ROW_GAP;
const TASK_AREA_TOP = PADDING + PLANNER_HEIGHT + PLANNER_GAP;

export const MIN_BOARD_ZOOM = 0.35;
export const MAX_BOARD_ZOOM = 2;

export type BoardNodeKind = 'planner' | 'task' | 'reviewer' | 'report';
export type BoardEdgeKind = 'plan' | 'depends' | 'review' | 'report';

export interface BoardNode {
  /** Stable across renders: `planner`, `task:<id>`, `reviewer:<id>`, `report`. */
  id: string;
  kind: BoardNodeKind;
  /** Dependency depth for tasks; the planner is column 0 and the report the last. */
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The task this node belongs to; null for the planner and the report. */
  taskId: string | null;
  title: string;
  /** Task state for task/reviewer nodes, goal state for planner and report. */
  state: TaskState | GoalState;
  /** Worker or reviewer model, whichever the node speaks for. */
  model: string | null;
  /** Latest reviewer verdict, when the reviewer has run at least once. */
  verdict: ReviewVerdict | null;
  round: number;
  critical: boolean;
}

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  kind: BoardEdgeKind;
  /** SVG path in board coordinates. */
  path: string;
}

export interface CouncilBoardLayout {
  nodes: BoardNode[];
  edges: BoardEdge[];
  width: number;
  height: number;
  /** Task columns after the planner; 0 when the plan has no tasks. */
  columns: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}

/**
 * One hue per council tone, shared by goal states, task states and review
 * verdicts so a status reads the same on the board and in the inspector list.
 */
export const COUNCIL_TONE_COLOR: Record<CouncilTone, string> = {
  neutral: 'var(--muted-foreground)',
  primary: 'var(--primary)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
};

export function taskStateColor(state: TaskState): string {
  return COUNCIL_TONE_COLOR[TASK_STATE_TONE[state]];
}

export function goalStateColor(state: GoalState): string {
  return COUNCIL_TONE_COLOR[GOAL_STATE_TONE[state]];
}

export function reviewVerdictColor(verdict: ReviewVerdict): string {
  return COUNCIL_TONE_COLOR[REVIEW_VERDICT_TONE[verdict]];
}

/**
 * Longest path from a task with no dependencies. A dependency naming a task that
 * is not in the plan is ignored, and a cycle is cut at the first repeat, so a
 * malformed plan still lays out instead of hanging.
 */
export function taskDepths(tasks: readonly Task[]): Map<string, number> {
  const byTitle = new Map<string, Task>();
  for (const task of tasks) byTitle.set(task.title.toLowerCase(), task);

  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(task: Task): number {
    const known = depths.get(task.id);
    if (known !== undefined) return known;
    if (visiting.has(task.id)) return 0;
    visiting.add(task.id);
    let depth = 0;
    for (const title of task.dependsOn) {
      const dependency = byTitle.get(title.toLowerCase());
      if (dependency === undefined || dependency.id === task.id) continue;
      depth = Math.max(depth, depthOf(dependency) + 1);
    }
    visiting.delete(task.id);
    depths.set(task.id, depth);
    return depth;
  }

  for (const task of tasks) depthOf(task);
  return depths;
}

/** Latest review per task id; reviews arrive oldest first. */
export function latestReviews(reviews: readonly Review[]): Map<string, Review> {
  const latest = new Map<string, Review>();
  for (const review of reviews) latest.set(review.taskId, review);
  return latest;
}

function compareTasks(left: Task, right: Task): number {
  const byTitle = left.title.toLowerCase().localeCompare(right.title.toLowerCase());
  if (byTitle !== 0) return byTitle;
  return left.id.localeCompare(right.id);
}

/**
 * A cubic bezier between two anchors. Horizontal pairs bow sideways, vertical
 * pairs bow up or down, and the control distance never collapses below 24px so a
 * short hop still reads as a curve rather than a kink.
 */
export function edgePath(from: BoardPoint, to: BoardPoint): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const reach = Math.max(24, Math.abs(dx) / 2) * (dx >= 0 ? 1 : -1);
    return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
  }
  const reach = Math.max(18, Math.abs(dy) / 2) * (dy >= 0 ? 1 : -1);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + reach}, ${to.x} ${to.y - reach}, ${to.x} ${to.y}`;
}

function anchorRight(node: BoardNode): BoardPoint {
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}

function anchorLeft(node: BoardNode): BoardPoint {
  return { x: node.x, y: node.y + node.height / 2 };
}

function anchorTop(node: BoardNode): BoardPoint {
  return { x: node.x + node.width / 2, y: node.y };
}

function anchorBottom(node: BoardNode): BoardPoint {
  return { x: node.x + node.width / 2, y: node.y + node.height };
}

/**
 * Lays the board out from one `council.status` snapshot: the planner on top, task
 * columns by dependency depth, a reviewer chip under every task, and the report in
 * the last column.
 */
export function layoutCouncilBoard(
  goal: Goal | null,
  tasks: readonly Task[],
  reviews: readonly Review[],
): CouncilBoardLayout {
  const nodes: BoardNode[] = [];
  const edges: BoardEdge[] = [];
  const depths = taskDepths(tasks);
  const latest = latestReviews(reviews);

  const columns =
    tasks.length === 0 ? 0 : Math.max(...tasks.map((task) => depths.get(task.id) ?? 0)) + 1;
  const reportColumn = columns === 0 ? 1 : columns;
  const width = PADDING * 2 + (reportColumn + 1) * COLUMN_STEP - COLUMN_GAP;

  const byColumn = new Map<number, Task[]>();
  for (const task of tasks) {
    const column = depths.get(task.id) ?? 0;
    const bucket = byColumn.get(column);
    if (bucket === undefined) byColumn.set(column, [task]);
    else bucket.push(task);
  }
  for (const bucket of byColumn.values()) bucket.sort(compareTasks);

  const maxRows = Math.max(1, ...[...byColumn.values()].map((bucket) => bucket.length));
  const taskAreaHeight = maxRows * ROW_STEP - ROW_GAP;
  const height = TASK_AREA_TOP + taskAreaHeight + PADDING;

  const planner: BoardNode = {
    id: 'planner',
    kind: 'planner',
    column: 0,
    row: 0,
    x: PADDING,
    y: PADDING,
    width: PLANNER_WIDTH,
    height: PLANNER_HEIGHT,
    taskId: null,
    title: 'Planner',
    state: goal?.state ?? 'intake',
    model: null,
    verdict: null,
    round: 0,
    critical: false,
  };
  nodes.push(planner);

  const taskNodes = new Map<string, BoardNode>();
  const reviewerNodes = new Map<string, BoardNode>();

  for (let column = 0; column < columns; column += 1) {
    const bucket = byColumn.get(column) ?? [];
    bucket.forEach((task, row) => {
      const x = PADDING + column * COLUMN_STEP;
      const y = TASK_AREA_TOP + row * ROW_STEP;
      const taskNode: BoardNode = {
        id: `task:${task.id}`,
        kind: 'task',
        column,
        row,
        x,
        y,
        width: TASK_WIDTH,
        height: TASK_HEIGHT,
        taskId: task.id,
        title: task.title,
        state: task.state,
        model: task.authorModel,
        verdict: latest.get(task.id)?.verdict ?? null,
        round: task.round,
        critical: task.critical,
      };
      taskNodes.set(task.id, taskNode);
      nodes.push(taskNode);

      const review = latest.get(task.id);
      const reviewer: BoardNode = {
        id: `reviewer:${task.id}`,
        kind: 'reviewer',
        column,
        row,
        x,
        y: y + TASK_HEIGHT + REVIEWER_GAP,
        width: TASK_WIDTH,
        height: REVIEWER_HEIGHT,
        taskId: task.id,
        title: task.title,
        state: task.state,
        model: task.reviewerModel,
        verdict: review?.verdict ?? null,
        round: task.round,
        critical: false,
      };
      reviewerNodes.set(task.id, reviewer);
      nodes.push(reviewer);

      edges.push({
        id: `review:${task.id}`,
        from: taskNode.id,
        to: reviewer.id,
        kind: 'review',
        path: edgePath(anchorBottom(taskNode), anchorTop(reviewer)),
      });
    });
  }

  const report: BoardNode = {
    id: 'report',
    kind: 'report',
    column: reportColumn,
    row: 0,
    x: PADDING + reportColumn * COLUMN_STEP,
    y: columns === 0 ? PADDING : TASK_AREA_TOP + (taskAreaHeight - REPORT_HEIGHT) / 2,
    width: REPORT_WIDTH,
    height: REPORT_HEIGHT,
    taskId: null,
    title: 'Report',
    state: goal?.state ?? 'intake',
    model: null,
    verdict: null,
    round: 0,
    critical: false,
  };
  nodes.push(report);

  const taskByTitle = new Map<string, Task>();
  for (const task of tasks) taskByTitle.set(task.title.toLowerCase(), task);

  // Edge order follows the same title order as the rows, so two snapshots that
  // differ only in row order produce the same edge list.
  const ordered = tasks.toSorted(compareTasks);
  for (const task of ordered) {
    const target = taskNodes.get(task.id);
    if (target === undefined) continue;
    const dependencies = task.dependsOn
      .map((title) => taskByTitle.get(title.toLowerCase()))
      .filter(
        (dependency): dependency is Task => dependency !== undefined && dependency.id !== task.id,
      );
    if (dependencies.length === 0) {
      edges.push({
        id: `plan:${task.id}`,
        from: planner.id,
        to: target.id,
        kind: 'plan',
        path: edgePath(anchorBottom(planner), anchorTop(target)),
      });
    }
    for (const dependency of dependencies) {
      const source = taskNodes.get(dependency.id);
      if (source === undefined) continue;
      edges.push({
        id: `depends:${dependency.id}->${task.id}`,
        from: source.id,
        to: target.id,
        kind: 'depends',
        path: edgePath(anchorRight(source), anchorLeft(target)),
      });
    }
    const reviewer = reviewerNodes.get(task.id);
    if (reviewer !== undefined) {
      edges.push({
        id: `report:${task.id}`,
        from: reviewer.id,
        to: report.id,
        kind: 'report',
        path: edgePath(anchorRight(reviewer), anchorLeft(report)),
      });
    }
  }

  if (tasks.length === 0) {
    edges.push({
      id: 'plan:report',
      from: planner.id,
      to: report.id,
      kind: 'plan',
      path: edgePath(anchorRight(planner), anchorLeft(report)),
    });
  }

  return { nodes, edges, width, height, columns };
}

/** Layout straight from a `council.status` result, or the empty board. */
export function boardLayoutFromStatus(
  status: RpcResult<'council.status'> | null,
): CouncilBoardLayout {
  if (status === null) return layoutCouncilBoard(null, [], []);
  return layoutCouncilBoard(status.goal, status.tasks, status.reviews);
}

/** Reviewer chip copy: the verdict once one exists, else the task's progress. */
export function reviewerLabel(node: BoardNode): string {
  if (node.verdict !== null) return REVIEW_VERDICT_LABEL[node.verdict];
  if (node.state === 'reviewing') return 'Reviewing';
  if (node.state === 'pr-open') return 'Review queued';
  if (node.state === 'queued' || node.state === 'provisioning') return 'Not started';
  if (node.state === 'running' || node.state === 'blocked') return 'Waiting';
  if (node.state === 'awaiting-captain') return 'Escalated';
  if (node.state === 'failed' || node.state === 'cancelled') return 'No review';
  return TASK_STATE_LABEL[node.state as TaskState];
}

/** Short verdict words for the reviewer chip, where the full label does not fit. */
const VERDICT_CHIP_LABEL: Record<ReviewVerdict, string> = {
  pass: 'Pass',
  'changes-requested': 'Changes',
  escalate: 'Escalate',
};

export function reviewerChipLabel(node: BoardNode): string {
  if (node.verdict !== null) return VERDICT_CHIP_LABEL[node.verdict];
  return reviewerLabel(node);
}

export interface BoardViewport {
  scale: number;
  x: number;
  y: number;
}

export interface BoardSize {
  width: number;
  height: number;
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, scale));
}

/** Scale and center the whole board inside the viewport, never above 1:1. */
export function fitViewport(content: BoardSize, viewport: BoardSize, padding = 16): BoardViewport {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = clampZoom(Math.min(1, usableWidth / content.width, usableHeight / content.height));
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

/** Goal copy for the planner and report nodes. */
export function goalLabel(goal: Goal | null): string {
  return goal === null ? 'No goal' : GOAL_STATE_LABEL[goal.state];
}
