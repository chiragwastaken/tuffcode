import type { ExtraToolName, ExtraToolRunner } from '@tuffcode/contracts';

export type { ExtraToolName, ExtraToolRunner };

/** Mirrors `EXTRA_TOOL_SCHEMAS` in `@tuffcode/prompt`; kept here for the runtime guard. */
export const EXTRA_TOOL_NAMES = ['mcp', 'memory', 'config'] as const;

export function isExtraToolName(value: unknown): value is ExtraToolName {
  return typeof value === 'string' && (EXTRA_TOOL_NAMES as readonly string[]).includes(value);
}
