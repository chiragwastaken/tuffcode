/**
 * Settings keys the Agents and tools section owns, plus the bounds the server
 * enforces for the default output budget. Kept out of the component so the
 * payload test can import it without a DOM.
 */
export const CONTEXT_SETTING_KEYS = [
  'maxOutputTokens',
  'contextWarningThreshold',
  'autoCompact',
  'showContextMeter',
] as const;

export const MAX_OUTPUT_TOKENS_MIN = 256;
export const MAX_OUTPUT_TOKENS_MAX = 65_536;

export function maxOutputTokensError(value: number): string | undefined {
  if (!Number.isInteger(value)) return 'Enter a whole number of tokens.';
  if (value < MAX_OUTPUT_TOKENS_MIN || value > MAX_OUTPUT_TOKENS_MAX) {
    return `Use between ${MAX_OUTPUT_TOKENS_MIN} and ${MAX_OUTPUT_TOKENS_MAX} tokens.`;
  }
  return undefined;
}
