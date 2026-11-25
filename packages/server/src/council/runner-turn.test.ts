import type { AdapterEvent, Approval, ServerEvent } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus } from '../events.js';
import type { Runner } from '../runner/runner.js';
import { silentLogger } from '../test-support.js';
import { createBusTurnRunner, decideApproval, MANUAL_DENY_REASON } from './runner-turn.js';
import type { RunTurnInput, TurnResult } from './types.js';

type SendBehavior = 'complete' | 'abort' | 'throw';

interface ApprovalRequest {
  approvalId: string;
  threadId: string;
  toolName: string;
  input: unknown;
}

interface FakeRunner extends Runner {
  approval: ApprovalRequest | null;
}

function fakeRunner(bus: EventBus, behavior: SendBehavior): FakeRunner {
  const runner: FakeRunner = {
    approval: null,
    listActive: () => [],
    send: async (threadId) => {
      if (behavior === 'throw') throw new Error('adapter exploded');
      const turnId = 'turn_1';
      queueMicrotask(() => {
        emitEvent(bus, threadId, { type: 'text.delta', turnId, text: 'hello ' });
        if (runner.approval !== null) {
          const request = runner.approval;
          const approval: Approval = {
            id: request.approvalId,
            threadId: request.threadId,
            toolCallId: 'call_1',
            toolName: request.toolName,
            input: request.input,
            decision: 'pending',
            createdAt: new Date().toISOString(),
            resolvedAt: null,
          };
          const event: ServerEvent = {
            kind: 'event',
            type: 'approval.requested',
            threadId: request.threadId,
            payload: approval,
          };
          bus.emit(event);
        }
        if (behavior === 'complete') {
          emitEvent(bus, threadId, { type: 'text.delta', turnId, text: 'world' });
          emitEvent(bus, threadId, { type: 'turn.finished', turnId, reason: 'complete' });
        }
      });
      return { turnId };
    },
    interrupt: async () => undefined,
    approve: async () => undefined,
    disposeThread: async () => undefined,
    disposeAll: async () => undefined,
    recoverOrphanedRuns: () => undefined,
  };
  return runner;
}

function emitEvent(bus: EventBus, threadId: string, event: AdapterEvent): void {
  bus.emit({ kind: 'event', type: 'thread.event', threadId, seq: 1, payload: event });
}

interface ApprovalCall {
  threadId: string;
  approvalId: string;
  decision: 'allow' | 'deny';
}

function harness(behavior: SendBehavior = 'complete'): {
  bus: EventBus;
  runner: FakeRunner;
  calls: ApprovalCall[];
  runTurn: (input: RunTurnInput) => Promise<TurnResult>;
  rejectApprovals: { value: Error | null };
} {
  const bus = createEventBus();
  const runner = fakeRunner(bus, behavior);
  const calls: ApprovalCall[] = [];
  const rejectApprovals: { value: Error | null } = { value: null };
  const runTurn = createBusTurnRunner({
    bus,
    runner,
    approve: (threadId, approvalId, decision) => {
      calls.push({ threadId, approvalId, decision });
      return rejectApprovals.value === null
        ? Promise.resolve()
        : Promise.reject(rejectApprovals.value);
    },
    logger: silentLogger(),
  });
  return { bus, runner, calls, runTurn, rejectApprovals };
}

describe('decideApproval', () => {
  it('allows a benign command on an auto goal', () => {
    expect(decideApproval({ input: { command: 'pnpm test' }, autonomy: 'auto' })).toEqual({
      decision: 'allow',
      reason: 'auto goal',
    });
  });

  it('denies every approval on a manual goal with the unattended reason', () => {
    expect(decideApproval({ input: { command: 'pnpm test' }, autonomy: 'manual' })).toEqual({
      decision: 'deny',
      reason: MANUAL_DENY_REASON,
    });
  });

  it('denies destructive commands even on an auto goal', () => {
    for (const command of [
      'rm -rf /',
      'rm -rf ~',
      'rm -rf *',
      'format c:',
      'diskpart',
      'git push --force origin main',
      'shutdown /s',
    ]) {
      expect(decideApproval({ input: { command }, autonomy: 'auto' }).decision).toBe('deny');
    }
  });

  it('does not treat a scoped delete as destructive', () => {
    expect(decideApproval({ input: { command: 'rm -rf build' }, autonomy: 'auto' }).decision).toBe(
      'allow',
    );
  });
});

describe('createBusTurnRunner', () => {
  it('accumulates text deltas and settles on the matching turn.finished', async () => {
    const { runTurn } = harness();
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    expect(result).toEqual({
      threadId: 'thr_1',
      turnId: 'turn_1',
      status: 'complete',
      text: 'hello world',
    });
  });

  it('ignores events from other threads', async () => {
    const { bus, runTurn } = harness();
    const { promise, resolve } = Promise.withResolvers<void>();
    bus.subscribe((event) => {
      if (event.type === 'thread.event' && event.threadId === 'thr_1') return;
      if (event.type === 'thread.event') resolve();
    });
    const resultPromise = runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    bus.emit({
      kind: 'event',
      type: 'thread.event',
      threadId: 'thr_other',
      seq: 1,
      payload: { type: 'text.delta', turnId: 'turn_x', text: 'not mine' },
    });
    await promise;
    const result = await resultPromise;
    expect(result.text).toBe('hello world');
  });

  it('settles interrupted as soon as the signal aborts', async () => {
    const { bus, runTurn } = harness('abort');
    const controller = new AbortController();
    const resultPromise = runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: controller.signal,
      autonomy: 'auto',
    });
    await new Promise<void>((resolve) => {
      bus.subscribe((event) => {
        if (event.type === 'thread.event' && event.payload.type === 'text.delta') resolve();
      });
    });
    controller.abort();
    const result = await resultPromise;
    expect(result.status).toBe('interrupted');
    expect(result.text).toBe('hello ');
  });

  it('returns interrupted without sending when the signal is already aborted', async () => {
    const { runner, runTurn } = harness();
    let sent = 0;
    runner.send = async () => {
      sent += 1;
      return { turnId: 'turn_1' };
    };
    const controller = new AbortController();
    controller.abort();
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: controller.signal,
      autonomy: 'auto',
    });
    expect(result.status).toBe('interrupted');
    expect(sent).toBe(0);
  });

  it('turns a rejected send into an error result', async () => {
    const { runTurn } = harness('throw');
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('adapter exploded');
  });

  it('allows a benign approval on an auto goal and still settles on turn.finished', async () => {
    const { runner, calls, runTurn } = harness();
    runner.approval = {
      approvalId: 'apv_1',
      threadId: 'thr_1',
      toolName: 'bash',
      input: { command: 'pnpm test' },
    };
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    expect(calls).toEqual([{ threadId: 'thr_1', approvalId: 'apv_1', decision: 'allow' }]);
    expect(result.status).toBe('complete');
    expect(result.text).toBe('hello world');
  });

  it('denies an approval on a manual goal', async () => {
    const { runner, calls, runTurn } = harness();
    runner.approval = {
      approvalId: 'apv_1',
      threadId: 'thr_1',
      toolName: 'bash',
      input: { command: 'pnpm test' },
    };
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'manual',
    });
    expect(calls).toEqual([{ threadId: 'thr_1', approvalId: 'apv_1', decision: 'deny' }]);
    expect(result.status).toBe('complete');
  });

  it('denies a destructive command even on an auto goal', async () => {
    const { runner, calls, runTurn } = harness();
    runner.approval = {
      approvalId: 'apv_1',
      threadId: 'thr_1',
      toolName: 'bash',
      input: { command: 'rm -rf /' },
    };
    await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    expect(calls).toEqual([{ threadId: 'thr_1', approvalId: 'apv_1', decision: 'deny' }]);
  });

  it('ignores an approval raised for another thread', async () => {
    const { runner, calls, runTurn } = harness();
    runner.approval = {
      approvalId: 'apv_other',
      threadId: 'thr_other',
      toolName: 'bash',
      input: { command: 'pnpm test' },
    };
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    expect(calls).toEqual([]);
    expect(result.status).toBe('complete');
  });

  it('keeps the turn alive when the approval row is already resolved', async () => {
    const { runner, calls, runTurn, rejectApprovals } = harness();
    rejectApprovals.value = new Error('approval already resolved');
    runner.approval = {
      approvalId: 'apv_1',
      threadId: 'thr_1',
      toolName: 'bash',
      input: { command: 'pnpm test' },
    };
    const result = await runTurn({
      threadId: 'thr_1',
      text: 'work',
      signal: new AbortController().signal,
      autonomy: 'auto',
    });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe('complete');
  });
});
