import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob as fsGlob, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, matchesGlob, relative, resolve } from 'node:path';
import type { AdapterDeps, PermissionMode, TurnContext } from '@tuffcode/contracts';
import { SUBAGENT_TOOL_NAME, TOOL_NAMES, isSubagentType, type ToolName } from '@tuffcode/prompt';
import { applyEol, dominantEol, normalizeEol, resolveWithin, type Eol } from '@tuffcode/shared';

const MAX_OUTPUT = 64 * 1024;
const MAX_READ_LINES = 2000;
const DEFAULT_BASH_TIMEOUT = 120000;
const MAX_BASH_TIMEOUT = 600000;
const MAX_GLOB_ENTRIES = 200;
const MAX_GREP_RESULTS = 200;
const LF = String.fromCharCode(10);
const IGNORED_DIRS: Record<string, true> = {
  '.git': true,
  node_modules: true,
  dist: true,
  out: true,
  coverage: true,
  '.tuffcode-ops': true,
};

export interface ToolSessionState {
  readSet: Map<string, string>;
}

export interface ToolExecResult {
  output: string;
  isError: boolean;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: TurnContext,
  state: ToolSessionState,
  deps: AdapterDeps,
) => Promise<ToolExecResult>;

export type PermissionDecision = 'allow' | 'approve' | 'deny';

export function createToolSessionState(): ToolSessionState {
  return { readSet: new Map() };
}

function ok(output: string): ToolExecResult {
  return { output, isError: false };
}

function fail(output: string): ToolExecResult {
  return { output, isError: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(field + ' must be a non-empty string');
  }
  return value;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(number, min), max);
}

function resolvePath(ctx: TurnContext, value: unknown, field: string): string {
  return resolveWithin(ctx.cwd, requireString(value, field));
}

function displayPath(root: string, target: string): string {
  const rel = relative(root, target);
  return rel.length === 0 ? '.' : rel.split('\\').join('/');
}

function readKey(target: string): string {
  return process.platform === 'win32' ? target.toLowerCase() : target;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function isIgnoredPath(value: string): boolean {
  return value.split(/[\\/]+/).some((segment) => IGNORED_DIRS[segment] === true);
}

function capOutput(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT) return text;
  const note = LF + '[output truncated]';
  const budget = MAX_OUTPUT - Buffer.byteLength(note, 'utf8');
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= budget) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low) + note;
}

const DESTRUCTIVE_COMMANDS: readonly RegExp[] = [
  /\brm\s+-[a-z]*[rf][a-z]*\s+(\/|~|\$HOME|\*)(\s|$)/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bgit\s+push\b[^\n]*--force/i,
  /\bshutdown\b/i,
];

export function classifyTool(
  name: ToolName,
  args: Record<string, unknown>,
  mode: PermissionMode,
): PermissionDecision {
  if (name === 'read' || name === 'glob' || name === 'grep') return 'allow';
  if (mode === 'read-only') return 'deny';
  if (mode === 'ask') return 'approve';
  if (mode === 'accept-edits') return name === 'bash' ? 'approve' : 'allow';
  if (name === 'bash' && typeof args.command === 'string') {
    const command = args.command;
    if (DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(command))) return 'approve';
  }
  return 'allow';
}

const readTool: ToolExecutor = async (args, ctx, state) => {
  try {
    const target = resolvePath(ctx, args.path, 'path');
    const label = displayPath(ctx.cwd, target);
    const bytes = await readFile(target);
    const text = decodeText(bytes);
    if (text === null) return fail(`cannot read ${label}: binary or non-UTF-8 file`);
    state.readSet.set(readKey(target), hashBytes(bytes));
    const lines = splitLines(text);
    if (lines.length === 0) return ok('(empty file)');
    const offset = clampInt(args.offset, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(args.limit, MAX_READ_LINES, 1, MAX_READ_LINES);
    if (offset > lines.length) {
      return ok(`[no lines at offset ${offset}; file has ${lines.length} lines]`);
    }
    const start = offset - 1;
    const end = Math.min(start + limit, lines.length);
    const body: string[] = [];
    for (let index = start; index < end; index += 1) {
      body.push(`${index + 1}: ${lines[index] ?? ''}`);
    }
    let output = body.join(LF);
    if (end < lines.length) {
      output += `${LF}[showing lines ${offset}-${end} of ${lines.length}]`;
    }
    return ok(capOutput(output));
  } catch (error) {
    return fail(errorMessage(error));
  }
};

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

const editTool: ToolExecutor = async (args, ctx, state) => {
  try {
    const target = resolvePath(ctx, args.path, 'path');
    const label = displayPath(ctx.cwd, target);
    const key = readKey(target);
    const expected = state.readSet.get(key);
    if (expected === undefined) return fail(`read the file first: ${label}`);
    const bytes = await readFile(target);
    if (hashBytes(bytes) !== expected) {
      return fail(`file changed since read; read it again: ${label}`);
    }
    const text = decodeText(bytes);
    if (text === null) return fail(`cannot edit ${label}: binary or non-UTF-8 file`);
    const oldString = typeof args.old_string === 'string' ? args.old_string : '';
    const newString = typeof args.new_string === 'string' ? args.new_string : '';
    if (oldString.length === 0) return fail('old_string must not be empty');
    const eol: Eol = dominantEol(text);
    const lfText = normalizeEol(text, 'lf');
    const oldLf = normalizeEol(oldString, 'lf');
    const newLf = normalizeEol(newString, 'lf');
    const occurrences = countOccurrences(lfText, oldLf);
    if (occurrences === 0) {
      return fail(`old_string not found in ${label}; read the file and retry with exact text`);
    }
    const replaceAll = args.replace_all === true;
    if (occurrences > 1 && !replaceAll) {
      return fail(
        `old_string matches ${occurrences} times in ${label}; add surrounding context to disambiguate`,
      );
    }
    const replaced = replaceAll ? occurrences : 1;
    let next: string;
    if (replaceAll) {
      next = lfText.split(oldLf).join(newLf);
    } else {
      const found = lfText.indexOf(oldLf);
      next = lfText.slice(0, found) + newLf + lfText.slice(found + oldLf.length);
    }
    const outBytes = Buffer.from(applyEol(next, eol), 'utf8');
    await writeFile(target, outBytes);
    state.readSet.set(key, hashBytes(outBytes));
    return ok(`edited ${label}: replaced ${replaced} occurrence(s)`);
  } catch (error) {
    return fail(errorMessage(error));
  }
};

const writeTool: ToolExecutor = async (args, ctx, state) => {
  try {
    const target = resolvePath(ctx, args.path, 'path');
    const label = displayPath(ctx.cwd, target);
    const content = typeof args.content === 'string' ? args.content : null;
    if (content === null) return fail('content must be a string');
    const info = await stat(target).catch(() => null);
    if (info?.isDirectory()) return fail(`cannot write ${label}: path is a directory`);
    let eol: Eol = 'lf';
    if (info) {
      const existing = decodeText(await readFile(target));
      if (existing !== null) eol = dominantEol(existing);
    }
    await mkdir(dirname(target), { recursive: true });
    const bytes = Buffer.from(applyEol(content, eol), 'utf8');
    await writeFile(target, bytes);
    state.readSet.set(readKey(target), hashBytes(bytes));
    return ok(`wrote ${label} (${bytes.byteLength} bytes)`);
  } catch (error) {
    return fail(errorMessage(error));
  }
};

const globTool: ToolExecutor = async (args, ctx) => {
  try {
    const pattern = requireString(args.pattern, 'pattern');
    const base = args.path === undefined ? ctx.cwd : resolvePath(ctx, args.path, 'path');
    const entries: string[] = [];
    for await (const entry of fsGlob(pattern, {
      cwd: base,
      followSymlinks: false,
      exclude: isIgnoredPath,
    })) {
      if (isIgnoredPath(entry)) continue;
      entries.push(entry);
      if (entries.length >= MAX_GLOB_ENTRIES * 10) break;
    }
    const matches = await Promise.all(
      entries.map(async (entry) => {
        const target = resolve(base, entry);
        const info = await stat(target).catch(() => null);
        return { target, mtime: info?.mtimeMs ?? 0, isFile: info?.isFile() ?? false };
      }),
    );
    const files = matches
      .filter((match) => match.isFile)
      .toSorted((left, right) => right.mtime - left.mtime)
      .slice(0, MAX_GLOB_ENTRIES);
    if (files.length === 0) return ok(`no files matched ${pattern}`);
    return ok(capOutput(files.map((file) => displayPath(ctx.cwd, file.target)).join(LF)));
  } catch (error) {
    return fail(errorMessage(error));
  }
};

const grepTool: ToolExecutor = async (args, ctx) => {
  try {
    const pattern = requireString(args.pattern, 'pattern');
    const flags = args.case_sensitive === false ? 'i' : '';
    let expression: RegExp;
    try {
      expression = new RegExp(pattern, flags);
    } catch (error) {
      return fail(`invalid regular expression: ${errorMessage(error)}`);
    }
    const maxResults = clampInt(args.max_results, MAX_GREP_RESULTS, 1, MAX_GREP_RESULTS);
    const target = args.path === undefined ? ctx.cwd : resolvePath(ctx, args.path, 'path');
    const info = await stat(target).catch(() => null);
    if (info === null) return fail(`path not found: ${displayPath(ctx.cwd, target)}`);
    const globFilter = typeof args.glob === 'string' && args.glob.length > 0 ? args.glob : null;
    const files: string[] = [];
    if (info.isFile()) {
      files.push(target);
    } else {
      for await (const entry of fsGlob('**/*', {
        cwd: target,
        followSymlinks: false,
        exclude: isIgnoredPath,
      })) {
        if (isIgnoredPath(entry)) continue;
        if (globFilter !== null && !matchesGlob(entry, globFilter)) continue;
        files.push(resolve(target, entry));
        if (files.length >= 5000) break;
      }
    }
    const results: string[] = [];
    for (const file of files) {
      const bytes = await readFile(file).catch(() => null);
      if (bytes === null) continue;
      if (bytes.subarray(0, 8192).includes(0)) continue;
      const text = decodeText(bytes);
      if (text === null) continue;
      const lines = splitLines(text);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (!expression.test(line)) continue;
        results.push(`${displayPath(ctx.cwd, file)}:${index + 1}: ${line}`);
        if (results.length >= maxResults) break;
      }
      if (results.length >= maxResults) break;
    }
    if (results.length === 0) return ok(`no matches for ${pattern}`);
    return ok(capOutput(results.join(LF)));
  } catch (error) {
    return fail(errorMessage(error));
  }
};

interface Shell {
  command: string;
  args: (command: string) => string[];
}

async function resolveShell(deps: AdapterDeps): Promise<Shell> {
  if (process.platform === 'win32') {
    const pwsh = await deps.resolveCommand('pwsh');
    if (pwsh !== null) {
      return {
        command: pwsh,
        args: (command) => ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    const powershell = await deps.resolveCommand('powershell');
    if (powershell !== null) {
      return {
        command: powershell,
        args: (command) => ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    const comspec = deps.env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe';
    return { command: comspec, args: (command) => ['/d', '/s', '/c', command] };
  }
  const bash = await deps.resolveCommand('bash');
  return { command: bash ?? '/bin/sh', args: (line) => ['-lc', line] };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    settle = done;
  });
  return { promise, resolve: settle };
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // The process already exited.
  }
}

interface ProcessOutcome {
  output: string;
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
  spawnError: string | null;
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal: AbortSignal },
): Promise<ProcessOutcome> {
  const { promise, resolve } = deferred<ProcessOutcome>();
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true });
  let output = '';
  let outputBytes = 0;
  let dropped = false;
  let timedOut = false;
  let aborted = false;
  let settled = false;
  let timer: NodeJS.Timeout;

  const append = (chunk: Buffer): void => {
    if (outputBytes >= MAX_OUTPUT) {
      dropped = true;
      return;
    }
    const remaining = MAX_OUTPUT - outputBytes;
    const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    output += slice.toString('utf8');
    outputBytes += slice.byteLength;
    if (slice.byteLength < chunk.byteLength) dropped = true;
  };

  const finish = (code: number | null, spawnError: string | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
    resolve({ output, code, timedOut, aborted, truncated: dropped, spawnError });
  };

  const onAbort = (): void => {
    aborted = true;
    killTree(child);
    setTimeout(() => finish(null, null), 250);
  };

  timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
    setTimeout(() => finish(null, null), 250);
  }, options.timeoutMs);

  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener('abort', onAbort, { once: true });

  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('close', (code) => finish(code, null));
  child.on('error', (error) => finish(null, error.message));
  return promise;
}

const bashTool: ToolExecutor = async (args, ctx, _state, deps) => {
  try {
    const command = requireString(args.command, 'command');
    const timeoutMs = clampInt(args.timeout_ms, DEFAULT_BASH_TIMEOUT, 1000, MAX_BASH_TIMEOUT);
    const cwd = args.cwd === undefined ? ctx.cwd : resolvePath(ctx, args.cwd, 'cwd');
    const shell = await resolveShell(deps);
    const outcome = await runProcess(shell.command, shell.args(command), {
      cwd,
      env: { ...process.env, ...deps.env },
      timeoutMs,
      signal: ctx.signal,
    });
    let output =
      outcome.spawnError !== null
        ? `failed to start shell: ${outcome.spawnError}`
        : outcome.output;
    if (outcome.truncated) output += `${LF}[output truncated]`;
    if (outcome.timedOut) output += `${LF}[timed out after ${timeoutMs}ms]`;
    if (outcome.aborted) output += `${LF}[aborted]`;
    if (output.length === 0) output = '(no output)';
    const isError =
      outcome.timedOut || outcome.aborted || outcome.spawnError !== null || outcome.code !== 0;
    return { output, isError };
  } catch (error) {
    return fail(errorMessage(error));
  }
};

/**
 * Delegation is allowed everywhere except a read-only turn; asking first matches the
 * other side-effecting tools, so `ask` mode shows one approval per spawn.
 */
export function classifySubagentTool(mode: PermissionMode): PermissionDecision {
  if (mode === 'read-only') return 'deny';
  return mode === 'ask' ? 'approve' : 'allow';
}

/**
 * Spawns a child and answers immediately with its id. The child's summary arrives as
 * a `subagent.finished` event and through `subagents.list`, never by blocking the
 * parent turn on a long-running child.
 */
async function subagentTool(
  args: Record<string, unknown>,
  ctx: TurnContext,
  deps: AdapterDeps,
): Promise<ToolExecResult> {
  if (deps.spawnSubagent === undefined) {
    return fail('the subagent tool is unavailable in this session');
  }
  if (!isSubagentType(args.type)) {
    return fail('type must be one of explorer, reviewer, notetaker, worker, planner');
  }
  if (typeof args.task !== 'string' || args.task.trim().length === 0) {
    return fail('task must be a non-empty string');
  }
  const model = typeof args.model === 'string' ? args.model.trim() : '';
  try {
    const spawned = await deps.spawnSubagent({
      cwd: ctx.cwd,
      type: args.type,
      task: args.task,
      ...(model.length === 0 ? {} : { model }),
    });
    return ok(
      `subagent ${spawned.childId} (${args.type}) ${spawned.status}. Poll subagents.list with the parent thread for its summary.`,
    );
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export const TOOL_EXECUTORS: Record<ToolName, ToolExecutor> = {
  bash: bashTool,
  read: readTool,
  edit: editTool,
  write: writeTool,
  glob: globTool,
  grep: grepTool,
};

export async function executeTool(
  name: string,
  args: unknown,
  ctx: TurnContext,
  state: ToolSessionState,
  deps: AdapterDeps,
): Promise<ToolExecResult> {
  const parsed =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  if (name === SUBAGENT_TOOL_NAME) return subagentTool(parsed, ctx, deps);
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    return fail(`unknown tool: ${name}`);
  }
  return TOOL_EXECUTORS[name as ToolName](parsed, ctx, state, deps);
}
