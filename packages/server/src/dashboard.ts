import type { DashboardThread, Thread, ThreadStatus } from '@tuffcode/contracts';
import type { Repos } from './db/repos/index.js';

/** A running thread with no event for this long is treated as quietly dead. */
export const STALLED_AFTER_MS = 5 * 60_000;

/** Why a thread belongs where it does in the Needs you list. */
export type DashboardReason =
  | 'needs-approval'
  | 'stalled'
  | 'failed'
  | 'ready-to-review'
  | 'running'
  | 'idle';

/**
 * The one precedence the server sorts by and the client groups by: a waiting
 * approval outranks everything, a quiet run outranks a failure, and a merged or
 * closed thread falls through to idle.
 */
export function dashboardReason(thread: DashboardThread): DashboardReason {
  if (thread.pendingApprovals.length > 0 || thread.status === 'needs-approval') {
    return 'needs-approval';
  }
  if (thread.stalled) return 'stalled';
  switch (thread.status) {
    case 'failed':
      return 'failed';
    case 'ready-to-review':
      return 'ready-to-review';
    case 'running':
      return 'running';
    default:
      return 'idle';
  }
}

const REASON_RANK: Record<DashboardReason, number> = {
  'needs-approval': 0,
  stalled: 1,
  failed: 2,
  'ready-to-review': 3,
  running: 4,
  idle: 5,
};

/**
 * Orders the dashboard: needs-approval, stalled, failed, ready-to-review, running,
 * then idle; newest activity first inside each group, thread id as the tiebreak so
 * the order is stable between identical timestamps.
 */
export function sortDashboardThreads(threads: readonly DashboardThread[]): DashboardThread[] {
  return threads.toSorted((left, right) => {
    const byReason = REASON_RANK[dashboardReason(left)] - REASON_RANK[dashboardReason(right)];
    if (byReason !== 0) return byReason;
    const byActivity = (right.lastEventAt ?? right.updatedAt).localeCompare(
      left.lastEventAt ?? left.updatedAt,
    );
    if (byActivity !== 0) return byActivity;
    return left.threadId.localeCompare(right.threadId);
  });
}

/**
 * Pure stall test: a run that is `running` and whose newest event is older than
 * `STALLED_AFTER_MS`. `now` is passed in so a test never waits on a clock.
 */
export function isStalled(
  status: ThreadStatus,
  lastEventAt: string | null,
  now: number,
  thresholdMs = STALLED_AFTER_MS,
): boolean {
  if (status !== 'running' || lastEventAt === null) return false;
  const last = Date.parse(lastEventAt);
  if (Number.isNaN(last)) return false;
  return now - last > thresholdMs;
}

const TARGET_KEYS = [
  'command',
  'path',
  'file_path',
  'pattern',
  'query',
  'url',
  'name',
  'task',
  'description',
] as const;

const SUMMARY_MAX_CHARS = 80;

function oneLine(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > SUMMARY_MAX_CHARS
    ? collapsed.slice(0, SUMMARY_MAX_CHARS - 3) + '...'
    : collapsed;
}

/**
 * The short target an approval is about: the first known path/command/query key,
 * else the first string value, collapsed onto one line and truncated. Never the
 * whole JSON body.
 */
export function approvalTarget(input: unknown): string {
  if (typeof input === 'string') return oneLine(input);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return '';
  const record = input as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return oneLine(value);
  }
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim().length > 0) return oneLine(value);
  }
  return '';
}

/** `tool name plus a short one-line target`, for the approval reason line. */
export function approvalSummary(toolName: string, input: unknown): string {
  const target = approvalTarget(input);
  return target.length === 0 ? toolName : `${toolName}: ${target}`;
}

function newestEventAt(repos: Repos, thread: Thread): string | null {
  if (thread.lastSeq === 0) return null;
  // Seq is append order, so the row carrying `lastSeq` is the newest event.
  const rows = repos.events.since(thread.id, thread.lastSeq - 1, 1);
  return rows[0]?.createdAt ?? null;
}

function toDashboardThread(
  repos: Repos,
  thread: Thread,
  projectName: string,
  now: number,
): DashboardThread {
  const latest = newestEventAt(repos, thread);
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    projectName,
    title: thread.title,
    status: thread.status,
    updatedAt: thread.updatedAt,
    lastEventAt: latest,
    stalled: isStalled(thread.status, latest, now),
    pendingApprovals: repos.approvals.listPending(thread.id).map((approval) => ({
      approvalId: approval.id,
      toolName: approval.toolName,
      inputSummary: approvalSummary(approval.toolName, approval.input),
    })),
  };
}

/**
 * Every root thread across every project, sorted for the Needs you view. Child
 * threads are excluded: their parent already answers for them, and a child row
 * would double count one run.
 */
export function dashboardThreads(repos: Repos, now: number = Date.now()): DashboardThread[] {
  const projects = new Map(repos.projects.list().map((project) => [project.id, project.name]));
  const rows: DashboardThread[] = [];
  for (const thread of repos.threads.list()) {
    if (thread.parentThreadId !== null) continue;
    const projectName = projects.get(thread.projectId);
    if (projectName === undefined) continue;
    rows.push(toDashboardThread(repos, thread, projectName, now));
  }
  return sortDashboardThreads(rows);
}
