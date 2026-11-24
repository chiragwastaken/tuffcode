import { query } from '@anthropic-ai/claude-agent-sdk';

/** The subset of the Agent SDK model row this module reads. */
export interface ClaudeModelInfo {
  /** Model identifier to pass back in API calls. */
  value?: string;
  /** Older SDK builds named the same field `id`. */
  id?: string;
  displayName?: string;
}

/** The subset of an Agent SDK `Query` model discovery needs. */
export interface ClaudeModelQuery {
  supportedModels(): Promise<ClaudeModelInfo[]>;
  interrupt?(): Promise<unknown>;
}

export interface ClaudeModelQueryParams {
  prompt: string;
  options: {
    cwd: string;
    pathToClaudeCodeExecutable: string;
    abortController: AbortController;
    permissionMode: 'default';
    persistSession: false;
  };
}

/** Test seam: inject a fake Agent SDK query instead of spawning the CLI. */
export type ClaudeModelQueryFn = (params: ClaudeModelQueryParams) => ClaudeModelQuery;

/** One row the CLI advertises, normalized for the caller. */
export interface ClaudeModelRow {
  id: string;
  label: string;
}

export interface ClaudeModelListDeps {
  /** Resolved path to the Claude Code executable. */
  pathToClaudeCodeExecutable: string;
  /** Directory the short-lived query runs in; defaults to the process cwd. */
  cwd?: string;
  /** Abort and close the query after this long. */
  timeoutMs?: number;
  queryFn?: ClaudeModelQueryFn;
}

const DEFAULT_TIMEOUT_MS = 5_000;

const defaultQueryFn: ClaudeModelQueryFn = ({ prompt, options }) => query({ prompt, options });

function normalize(infos: readonly ClaudeModelInfo[]): ClaudeModelRow[] {
  const rows: ClaudeModelRow[] = [];
  const seen = new Set<string>();
  for (const info of infos) {
    const id = (info.value ?? info.id ?? '').trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    const label = info.displayName?.trim();
    rows.push({ id, label: label !== undefined && label.length > 0 ? label : id });
  }
  return rows;
}

/**
 * Lists the models the installed Claude Code reports, using a short-lived Agent SDK
 * query. The query is interrupted and aborted in `finally`, so no CLI process outlives
 * the call. A failure rejects; the caller decides whether it is fatal.
 */
export async function listClaudeModels(deps: ClaudeModelListDeps): Promise<ClaudeModelRow[]> {
  const queryFn = deps.queryFn ?? defaultQueryFn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let handle: ClaudeModelQuery | null = null;
  try {
    handle = queryFn({
      prompt: '',
      options: {
        cwd: deps.cwd ?? process.cwd(),
        pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable,
        abortController: abort,
        permissionMode: 'default',
        persistSession: false,
      },
    });
    return normalize(await handle.supportedModels());
  } finally {
    clearTimeout(timer);
    await handle?.interrupt?.().catch(() => undefined);
    abort.abort();
  }
}
