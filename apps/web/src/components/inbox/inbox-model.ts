import type { DashboardThread } from '@tuffcode/contracts';
import { formatRelativeTime } from '../sidebar/sidebar-model';

/** Why a thread is in the Needs you list, in display order. */
export type InboxReason =
  | 'needs-approval'
  | 'stalled'
  | 'failed'
  | 'ready-to-review'
  | 'running'
  | 'idle';

export const INBOX_REASON_ORDER: readonly InboxReason[] = [
  'needs-approval',
  'stalled',
  'failed',
  'ready-to-review',
  'running',
  'idle',
];

export const INBOX_REASON_LABEL: Record<InboxReason, string> = {
  'needs-approval': 'Needs approval',
  stalled: 'Stalled',
  failed: 'Failed',
  'ready-to-review': 'Ready to review',
  running: 'Running',
  idle: 'Idle',
};

/** The reasons the badge counts: a decision is waiting, or a run went wrong or quiet. */
const ATTENTION_REASONS: readonly InboxReason[] = ['needs-approval', 'stalled', 'failed'];

/**
 * The same precedence the server sorts by: a waiting approval, then a quiet run,
 * then a failure, then review, then an active run. Merged and closed threads rest
 * in the idle group; their status chip still names the state.
 */
export function inboxReason(thread: DashboardThread): InboxReason {
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

/** Needs-approval plus failed plus stalled; each thread counts once. */
export function attentionCount(threads: readonly DashboardThread[]): number {
  let count = 0;
  for (const thread of threads) {
    if (ATTENTION_REASONS.includes(inboxReason(thread))) count += 1;
  }
  return count;
}

export interface InboxGroup {
  reason: InboxReason;
  label: string;
  threads: DashboardThread[];
}

/**
 * Groups the server's sorted rows by reason, empty groups dropped. Thread order
 * inside a group is kept as received: the server already sorted newest first.
 */
export function groupInboxThreads(threads: readonly DashboardThread[]): InboxGroup[] {
  const buckets = new Map<InboxReason, DashboardThread[]>();
  for (const thread of threads) {
    const reason = inboxReason(thread);
    const bucket = buckets.get(reason);
    if (bucket === undefined) buckets.set(reason, [thread]);
    else bucket.push(thread);
  }
  const groups: InboxGroup[] = [];
  for (const reason of INBOX_REASON_ORDER) {
    const bucket = buckets.get(reason);
    if (bucket === undefined || bucket.length === 0) continue;
    groups.push({ reason, label: INBOX_REASON_LABEL[reason], threads: bucket });
  }
  return groups;
}

/** The moment a row's relative time describes: the last event, else the last edit. */
export function inboxActivityAt(thread: DashboardThread): string {
  return thread.lastEventAt ?? thread.updatedAt;
}

/** One line saying why the thread is here. */
export function inboxReasonLine(thread: DashboardThread, now: number = Date.now()): string {
  const reason = inboxReason(thread);
  switch (reason) {
    case 'needs-approval': {
      const approval = thread.pendingApprovals[0];
      return approval === undefined ? 'Waiting for your approval' : approval.inputSummary;
    }
    case 'stalled':
      return 'No activity for ' + formatRelativeTime(inboxActivityAt(thread), now);
    case 'failed':
      return 'The last turn failed';
    case 'ready-to-review':
      return 'Ready for your review';
    case 'running':
      return 'Working now';
    case 'idle': {
      if (thread.lastEventAt === null) return 'No activity yet';
      const elapsed = formatRelativeTime(thread.lastEventAt, now);
      return elapsed === 'now' ? 'Active just now' : 'Last active ' + elapsed + ' ago';
    }
  }
}
