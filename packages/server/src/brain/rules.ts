import type { BrainEntry } from '@tuffcode/contracts';
import type { BrainStore } from './store.js';

/** Standing-rule phrase from spec section 8, step 4. */
export const STANDING_RULE_PATTERN = /always remember[:\s]+(.+)/i;

export interface CaptureStandingRuleInput {
  message: string;
  projectId?: string | null;
}

/**
 * Extracts a standing rule from a chat message and stores it as a rule that applies
 * to every turn. Returns the stored entry, or null when the message is not a rule.
 */
export function captureStandingRule(
  store: BrainStore,
  input: CaptureStandingRuleInput,
): BrainEntry | null {
  const match = STANDING_RULE_PATTERN.exec(input.message);
  if (match === null) return null;
  const quoted = match[1]?.replace(/\s+/g, ' ').trim() ?? '';
  if (quoted.length === 0) return null;
  return store.upsert({
    kind: 'rule',
    scope: 'global',
    projectId: input.projectId ?? null,
    text: quoted,
    appliesTo: 'all',
    importance: 0.9,
    sourceQuote: input.message.trim(),
  });
}
