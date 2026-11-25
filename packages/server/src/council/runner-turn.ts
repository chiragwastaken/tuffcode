import type { GoalAutonomy } from '@tuffcode/contracts';
import type { Logger } from '@tuffcode/shared';
import type { EventBus } from '../events.js';
import type { Runner } from '../runner/runner.js';
import type { RunTurnInput, TurnResult } from './types.js';

export interface BusTurnRunnerDeps {
  bus: EventBus;
  runner: Runner;
  /** Applies a decision to the child's approval row; the glue slice wires `runner.approve`. */
  approve(threadId: string, approvalId: string, decision: 'allow' | 'deny'): Promise<void>;
  logger: Logger;
}

/**
 * The harness denylist, mirrored from `packages/adapters/src/openai/tools.ts`. A
 * council child runs unattended, so a command that asks a user for approval there is
 * denied here outright instead of hanging the turn.
 */
const DESTRUCTIVE_COMMANDS: readonly RegExp[] = [
  /\brm\s+-[a-z]*[rf][a-z]*\s+(\/|~|\$HOME|\*)(\s|$)/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bgit\s+push\b[^\n]*--force/i,
  /\bshutdown\b/i,
];

/** Manual goals deny every approval with this line, so the reason is never silent. */
export const MANUAL_DENY_REASON = 'Council runs unattended; approve it from the child thread.';

export interface ApprovalDecision {
  decision: 'allow' | 'deny';
  reason: string;
}

/**
 * The command a tool would run, or the serialized input when the tool has no
 * `command` field. Testing the raw command keeps the end-of-string anchors working.
 */
function commandText(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input === null || typeof input !== 'object') return null;
  const command = (input as Record<string, unknown>)['command'];
  if (typeof command === 'string') return command;
  try {
    return JSON.stringify(input);
  } catch {
    return null;
  }
}

/**
 * Council's approval policy: destructive commands are denied even on an auto goal;
 * everything else is allowed only when the goal runs unattended by choice.
 */
export function decideApproval(input: {
  input: unknown;
  autonomy: GoalAutonomy;
}): ApprovalDecision {
  const text = commandText(input.input);
  if (text !== null) {
    const destructive = DESTRUCTIVE_COMMANDS.find((pattern) => pattern.test(text));
    if (destructive !== undefined) {
      return { decision: 'deny', reason: `destructive command (${destructive.source})` };
    }
  }
  if (input.autonomy === 'auto') return { decision: 'allow', reason: 'auto goal' };
  return { decision: 'deny', reason: MANUAL_DENY_REASON };
}

/**
 * Turns one runner send into an awaitable result by watching the event bus. The
 * runner deliberately returns before the turn runs, so council subscribes first,
 * buffers text deltas, and settles on the `turn.finished` frame for the turn id the
 * send returned. Child approvals are answered as they arrive so an unattended child
 * never waits on a user who is not there. Abort settles as interrupted without
 * waiting for a wedged adapter; cancellation has already told the runner to dispose
 * the thread.
 */
export function createBusTurnRunner(
  deps: BusTurnRunnerDeps,
): (input: RunTurnInput) => Promise<TurnResult> {
  return async ({ threadId, text, signal, autonomy }) => {
    if (signal.aborted) {
      return { threadId, turnId: '', status: 'interrupted', text: '' };
    }

    let buffer = '';
    let currentTurnId: string | null = null;
    const finished: { value: { turnId: string; reason: TurnResult['status'] } | null } = {
      value: null,
    };
    let settled = false;
    const { promise, resolve } = Promise.withResolvers<TurnResult>();
    const settle = (result: TurnResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const unsubscribe = deps.bus.subscribe((event) => {
      if (event.type !== 'thread.event' || event.threadId !== threadId) return;
      const payload = event.payload;
      if (payload.type === 'text.delta') {
        buffer += payload.text;
        return;
      }
      if (payload.type !== 'turn.finished') return;
      finished.value = { turnId: payload.turnId, reason: payload.reason };
      if (currentTurnId === payload.turnId) {
        settle({ threadId, turnId: payload.turnId, status: payload.reason, text: buffer });
      }
    });

    const answered = new Set<string>();
    const unsubscribeApprovals = deps.bus.subscribe((event) => {
      if (event.type !== 'approval.requested' || event.threadId !== threadId) return;
      const approvalId = event.payload.id;
      if (answered.has(approvalId)) return;
      answered.add(approvalId);
      const decision = decideApproval({ input: event.payload.input, autonomy });
      deps.logger.debug('council approval answered', {
        threadId,
        approvalId,
        toolName: event.payload.toolName,
        decision: decision.decision,
        reason: decision.reason,
      });
      // The row can already be resolved (an interrupt, or the user answering first);
      // that is a normal race, not a turn failure.
      void deps.approve(threadId, approvalId, decision.decision).catch((error: unknown) => {
        deps.logger.debug('council approval was not applied', {
          threadId,
          approvalId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });

    const onAbort = (): void => {
      settle({ threadId, turnId: currentTurnId ?? '', status: 'interrupted', text: buffer });
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const sent = await deps.runner.send(threadId, text);
      currentTurnId = sent.turnId;
      if (finished.value !== null && finished.value.turnId === sent.turnId) {
        settle({ threadId, turnId: sent.turnId, status: finished.value.reason, text: buffer });
      }
    } catch (error) {
      settle({
        threadId,
        turnId: '',
        status: 'error',
        text: buffer,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      return await promise;
    } finally {
      unsubscribe();
      unsubscribeApprovals();
      signal.removeEventListener('abort', onAbort);
    }
  };
}
