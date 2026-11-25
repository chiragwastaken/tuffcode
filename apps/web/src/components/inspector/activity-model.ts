import type {
  GoalState,
  RpcResult,
  SubagentType,
  TaskState,
  ThreadEventRow,
  ThreadStatus,
} from '@tuffcode/contracts';
import type { SubagentChild } from '../../store/app-store';
import { toolHeadline } from '../thread/turn-blocks';
import {
  GOAL_STATE_LABEL,
  GOAL_STATE_TONE,
  TASK_STATE_LABEL,
  TASK_STATE_TONE,
  isGoalTerminal,
  type CouncilTone,
} from './council-model';

/**
 * Pure helpers behind the Activity tab and its header badge: which tool calls
 * are still open, which have finished, how much work is running, and how long
 * an open call has been going. Nothing here touches the store.
 */

/** One tool call that started and has no matching `tool.finished` yet. */
export interface RunningToolRow {
  /** Unique across the thread and its children, used as the React key. */
  key: string;
  /** The subagent that ran the call, or null for the thread's own tools. */
  childId: string | null;
  childType: SubagentType | null;
  /** "Ran pnpm test": the same verb plus target the timeline shows. */
  headline: string;
  /** Output collected so far; empty until the tool streams something. */
  output: string;
  startedAt: string | null;
}

/** One tool call that started and has a matching `tool.finished`. */
export interface FinishedToolRow {
  /** Unique across the thread and its children, used as the React key. */
  key: string;
  /** The subagent that ran the call, or null for the thread's own tools. */
  childId: string | null;
  childType: SubagentType | null;
  toolCallId: string;
  /** "Ran pnpm test": the same verb plus target the timeline shows. */
  headline: string;
  /** The final output the `tool.finished` frame carried. */
  output: string;
  isError: boolean;
  finishedAt: string;
}

interface OpenTool {
  key: string;
  name: string;
  input: unknown;
  output: string;
  startedAt: string | null;
}

interface ClosedTool {
  key: string;
  toolCallId: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  finishedAt: string;
}

/** A tool call id is only unique within its turn, so the key carries both. */
function callKey(turnId: string, toolCallId: string): string {
  return `${turnId}:${toolCallId}`;
}

function openToolsOf(
  events: readonly ThreadEventRow[],
  child: SubagentChild | null,
): OpenTool[] {
  const open = new Map<string, OpenTool>();
  for (const row of events) {
    const payload = row.payload;
    if (payload.type === 'tool.started') {
      const key = callKey(payload.turnId, payload.toolCallId);
      open.set(key, {
        key,
        name: payload.name,
        input: payload.input,
        output: '',
        startedAt: row.createdAt,
      });
      continue;
    }
    if (payload.type === 'tool.delta') {
      const tool = open.get(callKey(payload.turnId, payload.toolCallId));
      if (tool !== undefined) tool.output += payload.text;
      continue;
    }
    if (payload.type === 'tool.finished') {
      open.delete(callKey(payload.turnId, payload.toolCallId));
    }
  }

  const prefix = child?.childId ?? 'thread';
  return [...open.values()].map((tool) => ({ ...tool, key: `${prefix}:${tool.key}` }));
}

function closedToolsOf(
  events: readonly ThreadEventRow[],
  child: SubagentChild | null,
): ClosedTool[] {
  const open = new Map<string, { toolCallId: string; name: string; input: unknown }>();
  const closed: ClosedTool[] = [];
  const prefix = child?.childId ?? 'thread';
  for (const row of events) {
    const payload = row.payload;
    if (payload.type === 'tool.started') {
      open.set(callKey(payload.turnId, payload.toolCallId), {
        toolCallId: payload.toolCallId,
        name: payload.name,
        input: payload.input,
      });
      continue;
    }
    if (payload.type !== 'tool.finished') continue;
    const key = callKey(payload.turnId, payload.toolCallId);
    const tool = open.get(key);
    if (tool === undefined) continue;
    open.delete(key);
    closed.push({
      key: `${prefix}:${key}`,
      toolCallId: tool.toolCallId,
      name: tool.name,
      input: tool.input,
      output: payload.output,
      isError: payload.isError,
      finishedAt: row.createdAt,
    });
  }
  return closed;
}

/**
 * Tool calls still running for the thread, followed by those of its live
 * children. Children keep the caller's order so a row never jumps between ticks.
 */
export function runningToolRows(
  events: readonly ThreadEventRow[],
  subagents: readonly SubagentChild[] = [],
): RunningToolRow[] {
  const rows: RunningToolRow[] = [];
  const sources: ReadonlyArray<{
    events: readonly ThreadEventRow[];
    child: SubagentChild | null;
  }> = [
    { events, child: null },
    ...subagents.map((child) => ({ events: child.events, child })),
  ];

  for (const source of sources) {
    for (const tool of openToolsOf(source.events, source.child)) {
      rows.push({
        key: tool.key,
        childId: source.child?.childId ?? null,
        childType: source.child?.type ?? null,
        headline: toolHeadline(tool.name, tool.input),
        output: tool.output,
        startedAt: tool.startedAt,
      });
    }
  }
  return rows;
}

/**
 * Tool calls that both started and finished, newest first, capped at `limit`.
 * The thread's own calls keep their place ahead of a child that finished in the
 * same millisecond. Calls still running belong to `runningToolRows`.
 */
export function finishedToolRows(
  events: readonly ThreadEventRow[],
  subagents: readonly SubagentChild[] = [],
  limit = 10,
): FinishedToolRow[] {
  const rows: FinishedToolRow[] = [];
  const sources: ReadonlyArray<{
    events: readonly ThreadEventRow[];
    child: SubagentChild | null;
  }> = [
    { events, child: null },
    ...subagents.map((child) => ({ events: child.events, child })),
  ];

  for (const source of sources) {
    for (const tool of closedToolsOf(source.events, source.child)) {
      rows.push({
        key: tool.key,
        childId: source.child?.childId ?? null,
        childType: source.child?.type ?? null,
        toolCallId: tool.toolCallId,
        headline: toolHeadline(tool.name, tool.input),
        output: tool.output,
        isError: tool.isError,
        finishedAt: tool.finishedAt,
      });
    }
  }

  rows.sort((left, right) => finishedTime(right.finishedAt) - finishedTime(left.finishedAt));
  return rows.slice(0, Math.max(0, limit));
}

/** Sort key for a finish timestamp; an unparseable one sorts last. */
function finishedTime(finishedAt: string): number {
  const parsed = Date.parse(finishedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** How many tool calls the thread itself has open right now. */
export function runningToolCount(events: readonly ThreadEventRow[]): number {
  const open = new Set<string>();
  for (const row of events) {
    const payload = row.payload;
    if (payload.type === 'tool.started') open.add(callKey(payload.turnId, payload.toolCallId));
    else if (payload.type === 'tool.finished') {
      open.delete(callKey(payload.turnId, payload.toolCallId));
    }
  }
  return open.size;
}

/** Children of one thread whose status is exactly `running`, queued excluded. */
export function countRunningSubagents(
  subagents: Readonly<Record<string, SubagentChild>>,
  threadId: string,
): number {
  let count = 0;
  for (const child of Object.values(subagents)) {
    if (child.threadId === threadId && child.status === 'running') count += 1;
  }
  return count;
}

/** The Activity button badge: open tool calls plus running children. */
export function activityCount(
  events: readonly ThreadEventRow[],
  subagents: Readonly<Record<string, SubagentChild>>,
  threadId: string,
): number {
  return runningToolCount(events) + countRunningSubagents(subagents, threadId);
}

/** One Waiting entry: a queued child, or the approval the timeline is holding. */
export type WaitingItem = { kind: 'approval' } | { kind: 'child'; child: SubagentChild };

/**
 * What the Waiting section lists: every queued child, plus one approval line when
 * the thread status says an approval is open. Approval rows live in the timeline,
 * so the thread status is the only approval signal this panel can read.
 */
export function waitingItems(
  subagents: readonly SubagentChild[],
  threadStatus: ThreadStatus | undefined,
): WaitingItem[] {
  const items: WaitingItem[] = subagents
    .filter((child) => child.status === 'queued')
    .map((child) => ({ kind: 'child', child }));
  if (threadStatus === 'needs-approval') items.push({ kind: 'approval' });
  return items;
}

/** Milliseconds an open call has been running, or null for a bad timestamp. */
export function runningElapsedMs(startedAt: string | null, nowMs: number): number | null {
  if (startedAt === null) return null;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start) || nowMs < start) return null;
  return nowMs - start;
}

/** One task line in the Activity panel's Council section. */
export interface CouncilActivityTask {
  id: string;
  title: string;
  state: TaskState;
  stateLabel: string;
  tone: CouncilTone;
}

/** The Council section of the Activity panel: the goal and its tasks. */
export interface CouncilActivity {
  goalState: GoalState;
  goalLabel: string;
  goalTone: CouncilTone;
  /** True until the goal reaches done, failed or cancelled. */
  goalActive: boolean;
  tasks: CouncilActivityTask[];
}

/**
 * The Council section reads straight from a `council.status` snapshot: the goal
 * state and one row per planned task, in plan order. A thread without a goal has
 * no section, and a goal that is still running keeps the panel from claiming
 * that nothing is running.
 */
export function councilActivityOf(
  status: RpcResult<'council.status'> | null,
): CouncilActivity | null {
  if (status === null) return null;
  return {
    goalState: status.goal.state,
    goalLabel: GOAL_STATE_LABEL[status.goal.state],
    goalTone: GOAL_STATE_TONE[status.goal.state],
    goalActive: !isGoalTerminal(status.goal.state),
    tasks: status.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      stateLabel: TASK_STATE_LABEL[task.state],
      tone: TASK_STATE_TONE[task.state],
    })),
  };
}
