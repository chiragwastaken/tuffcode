import type { DashboardThread } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  attentionCount,
  groupInboxThreads,
  inboxActivityAt,
  inboxReason,
  inboxReasonLine,
} from './inbox-model';

const NOW = Date.parse('2026-11-26T12:00:00.000Z');

function thread(overrides: Partial<DashboardThread> = {}): DashboardThread {
  return {
    threadId: 'thr_1',
    projectId: 'prj_1',
    projectName: 'project',
    title: 'New chat',
    status: 'idle',
    updatedAt: '2026-11-26T11:00:00.000Z',
    lastEventAt: null,
    stalled: false,
    pendingApprovals: [],
    ...overrides,
  };
}

describe('inboxReason', () => {
  it('puts a waiting approval above every other state', () => {
    expect(
      inboxReason(
        thread({
          status: 'needs-approval',
          pendingApprovals: [{ approvalId: 'apr_1', toolName: 'bash', inputSummary: 'bash: ls' }],
        }),
      ),
    ).toBe('needs-approval');
    expect(inboxReason(thread({ status: 'running', stalled: true }))).toBe('stalled');
    expect(inboxReason(thread({ status: 'failed' }))).toBe('failed');
    expect(inboxReason(thread({ status: 'ready-to-review' }))).toBe('ready-to-review');
    expect(inboxReason(thread({ status: 'running' }))).toBe('running');
    expect(inboxReason(thread({ status: 'merged' }))).toBe('idle');
  });
});

describe('attentionCount', () => {
  it('counts needs-approval, failed and stalled once each', () => {
    const threads = [
      thread({
        threadId: 'thr_approval',
        status: 'needs-approval',
        pendingApprovals: [{ approvalId: 'apr_1', toolName: 'bash', inputSummary: 'bash: ls' }],
      }),
      thread({ threadId: 'thr_stalled', status: 'running', stalled: true }),
      thread({ threadId: 'thr_failed', status: 'failed' }),
      thread({ threadId: 'thr_review', status: 'ready-to-review' }),
      thread({ threadId: 'thr_running', status: 'running' }),
      thread({ threadId: 'thr_idle' }),
    ];
    expect(attentionCount(threads)).toBe(3);
    expect(attentionCount([])).toBe(0);
  });
});

describe('groupInboxThreads', () => {
  it('groups by reason in display order and keeps the received thread order', () => {
    const reviewNew = thread({
      threadId: 'thr_review_new',
      status: 'ready-to-review',
      lastEventAt: '2026-11-26T11:30:00.000Z',
    });
    const reviewOld = thread({
      threadId: 'thr_review_old',
      status: 'ready-to-review',
      lastEventAt: '2026-11-26T09:00:00.000Z',
    });
    const approval = thread({
      threadId: 'thr_approval',
      status: 'needs-approval',
      pendingApprovals: [{ approvalId: 'apr_1', toolName: 'bash', inputSummary: 'bash: ls' }],
    });
    const failed = thread({ threadId: 'thr_failed', status: 'failed' });
    const idle = thread({ threadId: 'thr_idle' });

    const groups = groupInboxThreads([approval, reviewNew, failed, reviewOld, idle]);

    expect(groups.map((group) => group.reason)).toEqual([
      'needs-approval',
      'failed',
      'ready-to-review',
      'idle',
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      'Needs approval',
      'Failed',
      'Ready to review',
      'Idle',
    ]);
    expect(groups[2]?.threads.map((entry) => entry.threadId)).toEqual([
      'thr_review_new',
      'thr_review_old',
    ]);
    expect(groupInboxThreads([])).toEqual([]);
  });
});

describe('inboxReasonLine', () => {
  it('names the pending tool call and the quiet time', () => {
    const approval = thread({
      status: 'needs-approval',
      pendingApprovals: [
        { approvalId: 'apr_1', toolName: 'bash', inputSummary: 'bash: echo tuffcode-ok' },
      ],
    });
    expect(inboxReasonLine(approval, NOW)).toBe('bash: echo tuffcode-ok');

    const stalled = thread({
      status: 'running',
      stalled: true,
      lastEventAt: new Date(NOW - 12 * 60_000).toISOString(),
    });
    expect(inboxReasonLine(stalled, NOW)).toBe('No activity for 12m');

    expect(inboxReasonLine(thread({ status: 'failed' }), NOW)).toBe('The last turn failed');
    expect(inboxReasonLine(thread({ status: 'ready-to-review' }), NOW)).toBe(
      'Ready for your review',
    );
    expect(inboxReasonLine(thread({ status: 'running' }), NOW)).toBe('Working now');
    expect(inboxReasonLine(thread(), NOW)).toBe('No activity yet');
  });

  it('describes the last event of an idle thread and prefers it for the timestamp', () => {
    const idle = thread({ lastEventAt: '2026-11-26T09:00:00.000Z' });
    expect(inboxReasonLine(idle, NOW)).toBe('Last active 3h ago');
    expect(inboxActivityAt(idle)).toBe('2026-11-26T09:00:00.000Z');
    expect(inboxActivityAt(thread())).toBe('2026-11-26T11:00:00.000Z');
  });
});
