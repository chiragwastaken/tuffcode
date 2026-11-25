import type { AdapterDeps, TurnContext, TurnToolOptions } from '@tuffcode/contracts';
import {
  EXTRA_TOOL_SCHEMAS,
  SUBAGENT_TOOL,
  SUBAGENT_TOOL_NAME,
  TOOL_SCHEMAS,
  type ToolSchema,
} from '@tuffcode/prompt';

/** A file tool, the delegation tool, or a server-owned extra tool. */
export type HarnessToolSchema =
  | ToolSchema
  | { name: string; description: string; parameters: ToolSchema['parameters'] };

/** Which server tools a request offers; every flag defaults to off. */
export type ToolListOptions = Partial<TurnToolOptions>;

const NO_SERVER_TOOLS: TurnToolOptions = {
  subagent: false,
  extra: false,
  todo: false,
  skill: false,
  webFetch: false,
  mcp: false,
};

/**
 * The server tools this turn offers: what the harness can run (deps) narrowed by what
 * the server enabled for this turn (capabilities, thread kind). A context built without
 * `toolOptions` keeps the construction-time behaviour: every injected tool is offered.
 */
export function resolveToolOptions(ctx: TurnContext, deps: AdapterDeps): TurnToolOptions {
  const extra = deps.extraTool !== undefined;
  // Read-only turns still see the tool: status, wait, inbox and report are safe there,
  // and classifySubagentTool denies spawn, message and stop.
  const subagent = deps.spawnSubagent !== undefined;
  const available: TurnToolOptions = {
    subagent,
    extra,
    todo: extra,
    skill: extra,
    webFetch: extra,
    mcp: extra,
  };
  const wanted = ctx.toolOptions;
  if (wanted === undefined) return available;
  return {
    subagent: available.subagent && wanted.subagent,
    extra: available.extra && wanted.extra,
    todo: available.todo && wanted.todo,
    skill: available.skill && wanted.skill,
    webFetch: available.webFetch && wanted.webFetch,
    mcp: available.mcp && wanted.mcp,
  };
}

/** Whether a server tool name was offered this turn; file tools are gated by the allowlist. */
export function isServerToolOffered(name: string, options: TurnToolOptions): boolean {
  switch (name) {
    case SUBAGENT_TOOL_NAME:
      return options.subagent;
    case 'mcp':
      return options.extra && options.mcp;
    case 'memory':
    case 'config':
      return options.extra;
    case 'todo':
      return options.todo;
    case 'skill':
      return options.skill;
    case 'web_fetch':
      return options.webFetch;
    default:
      return true;
  }
}

export { NO_SERVER_TOOLS };

/**
 * The harness tools a turn may offer. An unset allowlist means every file tool, which
 * keeps a context built without settings on the pre-settings behaviour. The subagent
 * and extra tools are separate from the allowlist on purpose: `enabledTools` lists file
 * tools, and delegation or server tools must not disappear because the user narrowed
 * that list.
 */
export function allowedToolSchemas(
  allowlist?: readonly string[],
  options: ToolListOptions = {},
): readonly HarnessToolSchema[] {
  const tools: HarnessToolSchema[] =
    allowlist === undefined
      ? [...TOOL_SCHEMAS]
      : TOOL_SCHEMAS.filter((schema) => allowlist.includes(schema.name));
  // Callers that only say `extra` mean the original three tools, mcp included.
  const offered = { ...NO_SERVER_TOOLS, ...options, mcp: options.mcp ?? options.extra === true };
  if (offered.subagent) tools.push(SUBAGENT_TOOL);
  for (const schema of EXTRA_TOOL_SCHEMAS) {
    if (isServerToolOffered(schema.name, offered)) tools.push(schema);
  }
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
