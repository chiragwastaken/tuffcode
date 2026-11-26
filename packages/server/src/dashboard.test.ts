import type { DashboardThread } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  STALLED_AFTER_MS,
  approvalSummary,
  dashboardReason,
  isStalled,
  sortDashboardThreads,
} from './dashboard.js';

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

describe('isStalled', () => {
  it('treats a running thread quiet for longer than the threshold as stalled', () => {
    const quiet = new Date(NOW - STALLED_AFTER_MS - 1000).toISOString();
    expect(isStalled('running', quiet, NOW)).toBe(true);
  });

  it('keeps a running thread inside the threshold live', () => {
    const recent = new Date(NOW - STALLED_AFTER_MS + 1000).toISOString();
    expect(isStalled('running', recent, NOW)).toBe(false);
  });

  it('never stalls a thread that is not running or has no events', () => {
    const quiet = new Date(NOW - 60 * 60_000).toISOString();
    expect(isStalled('idle', quiet, NOW)).toBe(false);
    expect(isStalled('needs-approval', quiet, NOW)).toBe(false);
    expect(isStalled('running', null, NOW)).toBe(false);
    expect(isStalled('running', 'not-a-date', NOW)).toBe(false);
  });
});

describe('approvalSummary', () => {
  it('keeps the tool name and one short target', () => {
    expect(approvalSummary('bash', { command: 'echo tuffcode-ok' })).toBe('bash: echo tuffcode-ok');
    expect(approvalSummary('write', { path: 'src/index.ts', content: 'x' })).toBe(
      'write: src/index.ts',
    );
    expect(approvalSummary('read', 'src/index.ts')).toBe('read: src/index.ts');
  });

  it('collapses whitespace, truncates, and falls back to the tool name alone', () => {
    const summary = approvalSummary('bash', { command: `echo   ${'a'.repeat(200)}` });
    expect(summary.startsWith('bash: echo a')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual('bash: '.length + 80);
    expect(summary).not.toContain('\n');
    expect(approvalSummary('grep', { limit: 10 })).toBe('grep');
    expect(approvalSummary('grep', null)).toBe('grep');
  });
});

describe('dashboardReason', () => {
  it('ranks a waiting approval above a stall and a failure', () => {
    expect(
      dashboardReason(
        thread({
          status: 'needs-approval',
          pendingApprovals: [{ approvalId: 'apr_1', toolName: 'bash', inputSummary: 'bash: ls' }],
        }),
      ),
    ).toBe('needs-approval');
    expect(dashboardReason(thread({ status: 'running', stalled: true }))).toBe('stalled');
    expect(dashboardReason(thread({ status: 'failed' }))).toBe('failed');
    expect(dashboardReason(thread({ status: 'ready-to-review' }))).toBe('ready-to-review');
    expect(dashboardReason(thread({ status: 'running' }))).toBe('running');
    expect(dashboardReason(thread({ status: 'merged' }))).toBe('idle');
  });
});

describe('sortDashboardThreads', () => {
  it('orders by reason, then newest activity, then thread id', () => {
    const approval = thread({
      threadId: 'thr_approval',
      status: 'needs-approval',
      lastEventAt: '2026-11-26T10:00:00.000Z',
    });
    const stalled = thread({
      threadId: 'thr_stalled',
      status: 'running',
      stalled: true,
      lastEventAt: '2026-11-26T11:50:00.000Z',
    });
    const failed = thread({ threadId: 'thr_failed', status: 'failed' });
    const reviewOld = thread({
      threadId: 'thr_review_old',
      status: 'ready-to-review',
      lastEventAt: '2026-11-26T09:00:00.000Z',
    });
    const reviewNew = thread({
      threadId: 'thr_review_new',
      status: 'ready-to-review',
      lastEventAt: '2026-11-26T09:30:00.000Z',
    });
    const running = thread({ threadId: 'thr_running', status: 'running' });
    const idleA = thread({ threadId: 'thr_idle_a', updatedAt: '2026-11-26T08:00:00.000Z' });
    const idleB = thread({ threadId: 'thr_idle_b', updatedAt: '2026-11-26T08:00:00.000Z' });

    const sorted = sortDashboardThreads([
      idleB,
      running,
      reviewOld,
      failed,
      idleA,
      reviewNew,
      stalled,
      approval,
    ]);

    expect(sorted.map((entry) => entry.threadId)).toEqual([
      'thr_approval',
      'thr_stalled',
      'thr_failed',
      'thr_review_new',
      'thr_review_old',
      'thr_running',
      'thr_idle_a',
      'thr_idle_b',
    ]);
  });

  it('falls back to updatedAt when a thread has no events', () => {
    const older = thread({
      threadId: 'thr_a',
      status: 'failed',
      updatedAt: '2026-11-26T09:00:00.000Z',
    });
    const newer = thread({
      threadId: 'thr_b',
      status: 'failed',
      updatedAt: '2026-11-26T10:00:00.000Z',
    });
    expect(sortDashboardThreads([older, newer]).map((entry) => entry.threadId)).toEqual([
      'thr_b',
      'thr_a',
    ]);
  });
});
