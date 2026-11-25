/**
 * One accounting path for the runner, the `threads.context` RPC, and tests.
 *
 * The runner already assembled the prompt for the turn, so it passes the sections in;
 * the RPC has no turn in flight and plans the prompt from the thread's last user
 * message. Both resolve limits the same way and read the same conversation rows.
 */
import type { Thread } from '@tuffcode/contracts';
import type { Repos } from '../db/repos/index.js';
import type { LimitSource, ModelLimits } from './limits.js';
import { threadLimits } from './limits.js';
import {
  estimateContext,
  HARNESS_HISTORY_EVENT_LIMIT,
  harnessToolOutputs,
  type ContextSectionInput,
  type ContextUsage,
} from './usage.js';

export interface MeasureContextOptions {
  /** Message row already represented by the prompt sections; excluded from the estimate. */
  excludeMessageId?: string;
  /** Limits resolved earlier in the turn; skipped when absent. */
  limits?: ModelLimits;
}

/** The estimate plus which precedence step supplied its window (D46). */
export interface MeasuredContext extends ContextUsage {
  limitSource: LimitSource;
}

export function measureContext(
  repos: Repos,
  thread: Thread,
  sections: readonly ContextSectionInput[],
  options: MeasureContextOptions = {},
): MeasuredContext {
  const limits = options.limits ?? threadLimits(repos, thread, repos.settings.get());
  const messages = repos.messages
    .list(thread.id)
    .filter((message) => message.id !== options.excludeMessageId);
  const harnessHistory = harnessToolOutputs(
    repos.events.since(thread.id, 0, HARNESS_HISTORY_EVENT_LIMIT),
  );
  return {
    ...estimateContext({
      sections,
      messages,
      harnessHistory,
      contextWindow: limits.contextWindow,
    }),
    limitSource: limits.source,
  };
}
