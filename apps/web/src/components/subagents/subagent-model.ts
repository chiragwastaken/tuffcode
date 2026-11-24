import type { StatusKey } from '@tuffcode/ui';
import type { SubagentStatus, SubagentType, ThreadEventRow } from '@tuffcode/contracts';
import { Compass, Hammer, ListTree, NotebookPen, ShieldCheck, type LucideIcon } from 'lucide-react';
import { isTerminalSubagentStatus, type SubagentChild } from '../../store/app-store';

/** Harness tool the parent model calls to delegate; the spawn row names it. */
export const SUBAGENT_TOOL_NAME = 'subagent';

/** Spec 7.5: the child pane takes 42 percent of the timeline row by default. */
export const SUBAGENT_PANE_WIDTH_PERCENT = 42;

export const SUBAGENT_TYPES: readonly SubagentType[] = [
  'explorer',
  'reviewer',
  'notetaker',
  'worker',
  'planner',
];

export const SUBAGENT_TYPE_LABEL: Record<SubagentType, string> = {
  explorer: 'Explorer',
  reviewer: 'Reviewer',
  notetaker: 'Notetaker',
  worker: 'Worker',
  planner: 'Planner',
};

export const SUBAGENT_TYPE_ICON: Record<SubagentType, LucideIcon> = {
  explorer: Compass,
  reviewer: ShieldCheck,
  notetaker: NotebookPen,
  worker: Hammer,
  planner: ListTree,
};

export const SUBAGENT_STATUS_LABEL: Record<SubagentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Status hues reuse the thread palette: running is sky, done is emerald, failed is
 * red, a queued child reads neutral, and a cancelled child reads closed.
 */
export const SUBAGENT_STATUS_TONE: Record<SubagentStatus, StatusKey> = {
  queued: 'idle',
  running: 'running',
  done: 'ready-to-review',
  failed: 'failed',
  cancelled: 'closed',
};

/** Children of one parent thread in spawn order; object key order is insertion order. */
export function subagentsOfThread(
  subagents: Readonly<Record<string, SubagentChild>>,
  threadId: string,
): SubagentChild[] {
  return Object.values(subagents).filter((child) => child.threadId === threadId);
}

export function isRunningSubagent(child: SubagentChild): boolean {
  return !isTerminalSubagentStatus(child.status);
}

export function runningSubagentCount(children: readonly SubagentChild[]): number {
  return children.filter(isRunningSubagent).length;
}

/** Compact strip copy: "2 subagents running", or the settled total when none run. */
export function subagentStripLabel(children: readonly SubagentChild[]): string {
  const running = runningSubagentCount(children);
  const count = running > 0 ? running : children.length;
  const noun = count === 1 ? 'subagent' : 'subagents';
  return running > 0 ? `${count} ${noun} running` : `${count} ${noun}`;
}

/** Type icons for the strip, one per type present, with a count when repeated. */
export interface SubagentTypeCount {
  type: SubagentType;
  count: number;
}

export function subagentTypeCounts(children: readonly SubagentChild[]): SubagentTypeCount[] {
  const counts = new Map<SubagentType, number>();
  for (const child of children) {
    counts.set(child.type, (counts.get(child.type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

/** Elapsed time from start to finish, or to `nowMs` while the child runs. */
export function subagentElapsedMs(child: SubagentChild, nowMs: number): number | null {
  if (child.startedAt === null) return null;
  const start = Date.parse(child.startedAt);
  const end = child.finishedAt === null ? nowMs : Date.parse(child.finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/**
 * The pane's visible tab. A requested child wins; otherwise the first running child
 * keeps the pane on live work, and a settled-only set falls back to the first child.
 */
export function selectActiveSubagent(
  children: readonly SubagentChild[],
  activeChildId: string | null,
): SubagentChild | null {
  if (activeChildId !== null) {
    const requested = children.find((child) => child.childId === activeChildId);
    if (requested !== undefined) return requested;
  }
  return children.find(isRunningSubagent) ?? children[0] ?? null;
}

/** Turn ids in first-appearance order; "Turn 2" is the second turn the parent ran. */
export function turnOrdinals(events: readonly ThreadEventRow[]): Map<string, number> {
  const ordinals = new Map<string, number>();
  for (const row of events) {
    const payload = row.payload;
    if (!('turnId' in payload)) continue;
    if (ordinals.has(payload.turnId)) continue;
    ordinals.set(payload.turnId, ordinals.size + 1);
  }
  return ordinals;
}

export interface SubagentPlacementGroup {
  turnId: string;
  /** "Turn 2" for the parent turn that spawned the group. */
  label: string;
  children: SubagentChild[];
}

export interface SubagentPlacement {
  /** Groups in parent-turn order. */
  groups: SubagentPlacementGroup[];
  /** Children whose spawn row is not in the loaded event log. */
  unplaced: SubagentChild[];
}

interface SpawnTool {
  toolCallId: string;
  turnId: string;
  task: string;
  output: string;
}

function taskOf(input: unknown): string {
  if (input === null || typeof input !== 'object') return '';
  const task = (input as Record<string, unknown>)['task'];
  return typeof task === 'string' ? task.trim() : '';
}

/**
 * Attributes each child to the parent turn that spawned it. The tool result names
 * the child id, which is exact once the call settles; while it runs, the spec task
 * text matches the child's task. A child with no match is reported as unplaced so
 * the UI can still show it instead of dropping it.
 */
export function placeSubagents(
  children: readonly SubagentChild[],
  events: readonly ThreadEventRow[],
): SubagentPlacement {
  const tools: SpawnTool[] = [];
  const byCall = new Map<string, SpawnTool>();

  for (const row of events) {
    const payload = row.payload;
    if (payload.type === 'tool.started' && payload.name === SUBAGENT_TOOL_NAME) {
      const tool: SpawnTool = {
        toolCallId: payload.toolCallId,
        turnId: payload.turnId,
        task: taskOf(payload.input),
        output: '',
      };
      tools.push(tool);
      byCall.set(tool.toolCallId, tool);
      continue;
    }
    if (payload.type === 'tool.delta') {
      const tool = byCall.get(payload.toolCallId);
      if (tool !== undefined) tool.output += payload.text;
      continue;
    }
    if (payload.type === 'tool.finished') {
      const tool = byCall.get(payload.toolCallId);
      if (tool !== undefined) tool.output = payload.output;
    }
  }

  const assigned = new Map<string, string>();
  const claimed = new Set<string>();

  for (const child of children) {
    const tool = tools.find((entry) => entry.output.includes(child.childId));
    if (tool === undefined) continue;
    assigned.set(child.childId, tool.turnId);
    claimed.add(tool.toolCallId);
  }

  for (const child of children) {
    if (assigned.has(child.childId)) continue;
    const task = child.task.trim();
    if (task.length === 0) continue;
    const tool = tools.find((entry) => !claimed.has(entry.toolCallId) && entry.task === task);
    if (tool === undefined) continue;
    assigned.set(child.childId, tool.turnId);
    claimed.add(tool.toolCallId);
  }

  const ordinals = turnOrdinals(events);
  const grouped = new Map<string, SubagentChild[]>();
  const unplaced: SubagentChild[] = [];

  for (const child of children) {
    const turnId = assigned.get(child.childId);
    if (turnId === undefined) {
      unplaced.push(child);
      continue;
    }
    const list = grouped.get(turnId);
    if (list !== undefined) list.push(child);
    else grouped.set(turnId, [child]);
  }

  const groups = [...grouped.entries()]
    .toSorted(
      ([left], [right]) =>
        (ordinals.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (ordinals.get(right) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([turnId, list]) => ({
      turnId,
      label: `Turn ${ordinals.get(turnId) ?? '?'}`,
      children: list,
    }));

  return { groups, unplaced };
}

/** A rectangle in viewport coordinates; DOMRect satisfies it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ConnectorGeometry {
  /** SVG path from the card's right edge to the pane header's left edge. */
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A 1px cubic connector from the active subagent card to the pane header. Both
 * boxes are viewport rects; `origin` is the box the SVG renders inside, so the
 * returned coordinates are already relative to it.
 */
export function connectorGeometry(card: Box, header: Box, origin: Box): ConnectorGeometry {
  const x1 = round1(card.left + card.width - origin.left);
  const y1 = round1(card.top + card.height / 2 - origin.top);
  const x2 = round1(header.left - origin.left);
  const y2 = round1(header.top + header.height / 2 - origin.top);
  const bend = round1(Math.min(48, Math.max(16, Math.abs(x2 - x1) / 2)));
  return {
    x1,
    y1,
    x2,
    y2,
    d: `M ${x1} ${y1} C ${round1(x1 + bend)} ${y1}, ${round1(x2 - bend)} ${y2}, ${x2} ${y2}`,
  };
}
