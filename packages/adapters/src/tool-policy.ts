import { TOOL_SCHEMAS, type ToolSchema } from '@tuffcode/prompt';

/**
 * The harness tools a turn may offer. An unset allowlist means every tool, which
 * keeps a context built without settings on the pre-settings behaviour.
 */
export function allowedToolSchemas(allowlist?: readonly string[]): readonly ToolSchema[] {
  if (allowlist === undefined) return TOOL_SCHEMAS;
  return TOOL_SCHEMAS.filter((schema) => allowlist.includes(schema.name));
}

/** True when settings disabled this tool, so a call must be answered with an error. */
export function isToolDisabled(name: string, allowlist: readonly string[] | undefined): boolean {
  return allowlist !== undefined && !allowlist.includes(name);
}

/**
 * The tighter of the per-turn settings cap and the adapter's own cap, so a provider
 * narrowed below the global setting still narrows, and the setting always bounds it.
 */
export function effectiveToolIterations(
  turn: number | undefined,
  adapter: number | undefined,
  fallback: number,
): number {
  if (turn === undefined) return adapter ?? fallback;
  if (adapter === undefined) return turn;
  return Math.min(turn, adapter);
}
