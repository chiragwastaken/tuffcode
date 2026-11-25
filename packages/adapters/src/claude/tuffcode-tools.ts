import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { AdapterDeps, PermissionMode, TurnContext } from '@tuffcode/contracts';
import { SUBAGENT_TOOL_NAME, isSubagentAction, isSubagentType } from '@tuffcode/prompt';
import { z } from 'zod';
import { classifyExtraTool, classifySubagentTool, type PermissionDecision } from '../openai/tools.js';
import { resolveToolOptions } from '../tool-policy.js';

/**
 * Tuffcode's own tools for Claude sessions. The Claude CLI runs its own tool loop, so
 * the harness tools reach it as an in-process SDK MCP server named `tuffcode`: the
 * task list, subagent control, memory, skills and web_fetch share one implementation
 * with the harness adapters and land in the same thread state.
 */
export const TUFFCODE_SERVER_NAME = 'tuffcode';
const PREFIX = `mcp__${TUFFCODE_SERVER_NAME}__`;

type ToolText = { content: { type: 'text'; text: string }[]; isError?: boolean };

function text(value: string, isError = false): ToolText {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function failure(error: unknown): ToolText {
  return text(error instanceof Error ? error.message : String(error), true);
}

/** Drops undefined fields so the server-side runner sees the same shape the harness sends. */
function defined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}

/**
 * The permission decision for a `mcp__tuffcode__*` call, or null for any other tool.
 * Mirrors the harness: status reads, todo and skill never ask; spawning, messaging and
 * stopping follow the permission ladder.
 */
export function classifyTuffcodeTool(
  toolName: string,
  input: Record<string, unknown>,
  mode: PermissionMode,
): PermissionDecision | null {
  if (!toolName.startsWith(PREFIX)) return null;
  const name = toolName.slice(PREFIX.length);
  if (name === SUBAGENT_TOOL_NAME) return classifySubagentTool(mode, input);
  if (name === 'todo' || name === 'skill' || name === 'web_fetch' || name === 'memory' || name === 'config') {
    return classifyExtraTool(name, input, mode);
  }
  return 'deny';
}

/** The in-process server for one turn, or undefined when the turn offers none of the tools. */
export function tuffcodeServer(
  deps: AdapterDeps,
  ctx: TurnContext,
): Record<string, unknown> | undefined {
  const options = resolveToolOptions(ctx, deps);
  const runner = deps.extraTool;
  const scope = { cwd: ctx.cwd, ...(ctx.threadId === undefined ? {} : { threadId: ctx.threadId }) };
  const tools = [];

  if (options.todo && runner !== undefined) {
    tools.push(
      tool(
        'todo',
        'Track multi-step work as a phased task list the user sees live. op: init (list or items), start (task), done, drop, rm (task, phase, or all), append (items, phase), view. Keep one task in progress; mark it done right after verifying.',
        {
          op: z.enum(['init', 'start', 'done', 'drop', 'rm', 'append', 'view']),
          list: z.array(z.object({ phase: z.string().optional(), items: z.array(z.string()) })).optional(),
          items: z.array(z.string()).optional(),
          task: z.string().optional(),
          phase: z.string().optional(),
        },
        async (args) => {
          try {
            return text(await runner('todo', defined(args), scope));
          } catch (error) {
            return failure(error);
          }
        },
      ),
    );
  }

  if (options.subagent && deps.spawnSubagent !== undefined) {
    const spawn = deps.spawnSubagent;
    const control = deps.subagentControl;
    tools.push(
      tool(
        SUBAGENT_TOOL_NAME,
        'Run and control Tuffcode subagents. action spawn (default) starts explorer, reviewer, notetaker, worker or planner with a self-contained task and returns its id; status lists children with tool count, tokens and activity; wait blocks until children settle (timeout_s); message steers a child; stop cancels one; inbox reads unread reports.',
        {
          action: z.string().optional(),
          id: z.string().optional(),
          text: z.string().optional(),
          timeout_s: z.number().int().min(1).max(600).optional(),
          type: z.string().optional(),
          task: z.string().optional(),
          model: z.string().optional(),
        },
        async (args) => {
          const action = args.action ?? 'spawn';
          try {
            if (!isSubagentAction(action)) return text(`unknown action: ${action}`, true);
            if (action === 'spawn') {
              if (!isSubagentType(args.type)) {
                return text('type must be one of explorer, reviewer, notetaker, worker, planner', true);
              }
              if (args.task === undefined || args.task.trim().length === 0) return text('task is required', true);
              const spawned = await spawn({
                ...scope,
                type: args.type,
                task: args.task,
                ...(args.model === undefined ? {} : { model: args.model }),
              });
              return text(`subagent ${spawned.childId} (${args.type}) ${spawned.status}. Use action wait to collect its summary.`);
            }
            if (control === undefined) return text(`subagent ${action} is unavailable`, true);
            return text(
              await control({
                action,
                ...scope,
                ...(args.id === undefined ? {} : { id: args.id }),
                ...(args.text === undefined ? {} : { text: args.text }),
                ...(args.timeout_s === undefined ? {} : { timeoutSeconds: args.timeout_s }),
                signal: ctx.signal,
              }),
            );
          } catch (error) {
            return failure(error);
          }
        },
      ),
    );
  }

  if (options.extra && runner !== undefined) {
    tools.push(
      tool(
        'memory',
        'Search Tuffcode brain memory or record one durable entry. action: search (query) or add (kind, text, tags, importance).',
        {
          action: z.enum(['search', 'add']),
          query: z.string().optional(),
          kind: z.string().optional(),
          text: z.string().optional(),
          tags: z.string().optional(),
          importance: z.string().optional(),
        },
        async (args) => {
          try {
            return text(await runner('memory', defined(args), scope));
          } catch (error) {
            return failure(error);
          }
        },
      ),
    );
  }

  if (options.skill && runner !== undefined) {
    tools.push(
      tool(
        'skill',
        'Load the full instructions of one skill listed under Available skills.',
        { name: z.string() },
        async (args) => {
          try {
            return text(await runner('skill', defined(args), scope));
          } catch (error) {
            return failure(error);
          }
        },
      ),
    );
  }

  if (options.webFetch && runner !== undefined) {
    tools.push(
      tool(
        'web_fetch',
        'Fetch one public http or https URL and return its readable text.',
        { url: z.string(), max_chars: z.number().int().min(500).max(64000).optional() },
        async (args) => {
          try {
            return text(await runner('web_fetch', defined(args), scope));
          } catch (error) {
            return failure(error);
          }
        },
      ),
    );
  }

  if (tools.length === 0) return undefined;
  return {
    [TUFFCODE_SERVER_NAME]: createSdkMcpServer({ name: TUFFCODE_SERVER_NAME, version: '1.0.0', tools }),
  };
}
