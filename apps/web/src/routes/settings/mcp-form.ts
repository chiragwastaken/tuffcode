import type { McpServer } from '@tuffcode/contracts';

/** The add/edit form state for one stdio MCP server. */
export interface McpDraft {
  id?: string;
  label: string;
  command: string;
  args: string;
  env: string;
  cwd: string;
  enabled: boolean;
}

export interface McpFieldErrors {
  label?: string;
  command?: string;
  env?: string;
  cwd?: string;
}

export interface McpUpsertParams {
  id?: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  enabled: boolean;
}

export interface ParsedEnv {
  env?: Record<string, string>;
  error?: string;
}

export function emptyMcpDraft(): McpDraft {
  return { label: '', command: '', args: '', env: '', cwd: '', enabled: true };
}

export function mcpDraftFromServer(server: McpServer): McpDraft {
  return {
    id: server.id,
    label: server.label,
    command: server.command,
    args: server.args.join('\n'),
    env: Object.keys(server.env).length > 0 ? JSON.stringify(server.env, null, 2) : '',
    cwd: server.cwd ?? '',
    enabled: server.enabled,
  };
}

/** Arguments are whitespace separated; one per line also works. */
export function parseMcpArgs(text: string): string[] {
  return text.split(/\s+/).filter((arg) => arg.length > 0);
}

/** Parses the env field as a JSON object of strings; blank means no variables. */
export function parseMcpEnv(text: string): ParsedEnv {
  const trimmed = text.trim();
  if (!trimmed) return { env: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: 'Environment must be valid JSON.' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Environment must be a JSON object.' };
  }

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      return { error: `Environment value for ${name} must be a string.` };
    }
    env[name] = value;
  }

  return { env };
}

export function validateMcpDraft(draft: McpDraft): McpFieldErrors {
  const errors: McpFieldErrors = {};

  if (!draft.label.trim()) errors.label = 'Label is required.';
  if (!draft.command.trim()) errors.command = 'Command is required.';

  const parsedEnv = parseMcpEnv(draft.env);
  if (parsedEnv.error) errors.env = parsedEnv.error;

  const cwd = draft.cwd.trim();
  if (cwd && !/^[A-Za-z]:[\\/]|^\/|^~[\\/]/.test(cwd)) {
    errors.cwd = 'Enter an absolute path.';
  }

  return errors;
}

/** Builds the `mcp.upsert` params; invalid env JSON throws instead of dropping it. */
export function buildMcpUpsertParams(draft: McpDraft): McpUpsertParams {
  const parsedEnv = parseMcpEnv(draft.env);
  if (parsedEnv.error) throw new Error(parsedEnv.error);

  const cwd = draft.cwd.trim();
  return {
    ...(draft.id ? { id: draft.id } : {}),
    label: draft.label.trim(),
    command: draft.command.trim(),
    args: parseMcpArgs(draft.args),
    env: parsedEnv.env ?? {},
    cwd: cwd ? cwd : null,
    enabled: draft.enabled,
  };
}
