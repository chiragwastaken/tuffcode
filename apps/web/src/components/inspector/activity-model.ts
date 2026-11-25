import type { SubagentType, ThreadEventRow, ThreadStatus } from '@tuffcode/contracts';
import type { SubagentChild } from '../../store/app-store';
import { toolHeadline } from '../thread/turn-blocks';

/**
 * Pure helpers behind the Activity tab and its header badge: which tool calls
 * are still open, how much work is running, and how long an open call has been
 * going. Nothing here touches the store.
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

interface OpenTool {
  key: string;
  name: string;
  input: unknown;
  output: string;
  startedAt: string | null;
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
