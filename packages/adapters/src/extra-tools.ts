import type { ExtraToolRunner } from '@tuffcode/contracts';
import { EXTRA_TOOL_NAMES, type ExtraToolName } from '@tuffcode/prompt';

export type { ExtraToolName, ExtraToolRunner };
export { EXTRA_TOOL_NAMES };

export function isExtraToolName(value: unknown): value is ExtraToolName {
  return typeof value === 'string' && (EXTRA_TOOL_NAMES as readonly string[]).includes(value);
}
