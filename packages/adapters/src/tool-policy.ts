import { SUBAGENT_TOOL, TOOL_SCHEMAS, type ToolSchema } from '@tuffcode/prompt';

/** A file tool or the delegation tool; both serialize to the same request shape. */
export type HarnessToolSchema =
  | ToolSchema
  | { name: string; description: string; parameters: ToolSchema['parameters'] };

export interface ToolListOptions {
  /** Offer the `subagent` tool. The server sets this when the harness can spawn. */
  subagent?: boolean;
}

/**
 * The harness tools a turn may offer. An unset allowlist means every file tool, which
 * keeps a context built without settings on the pre-settings behaviour. The subagent
 * tool is separate from the allowlist on purpose: `enabledTools` lists file tools, and
 * delegation must not disappear because the user narrowed that list.
 */
export function allowedToolSchemas(
  allowlist?: readonly string[],
  options: ToolListOptions = {},
): readonly HarnessToolSchema[] {
  const tools: HarnessToolSchema[] =
    allowlist === undefined
      ? [...TOOL_SCHEMAS]
      : TOOL_SCHEMAS.filter((schema) => allowlist.includes(schema.name));
  if (options.subagent === true) tools.push(SUBAGENT_TOOL);
  return tools;
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
