import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterDeps, AdapterLogger, TurnContext } from '@tuffcode/contracts';
import { classifyTool, createToolSessionState, executeTool } from './tools.js';

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + LF;

const logger: AdapterLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const deps: AdapterDeps = {
  logger,
  resolveCommand: async () => null,
  env: {},
};

let root: string;

function context(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    turnId: 'turn_1',
    cwd: root,
    systemPrompt: '',
    permissionMode: 'full-auto',
    model: 'test-model',
    brainSlice: '',
    attachments: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tuffcode-openai-tools-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('read and edit', () => {
  it('rejects edit before read', async () => {
    await writeFile(join(root, 'a.txt'), 'alpha' + LF);
    const state = createToolSessionState();
    const result = await executeTool(
      'edit',
      { path: 'a.txt', old_string: 'alpha', new_string: 'beta' },
      context(),
      state,
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('read the file first');
  });

  it('rejects paths outside the worktree root', async () => {
    const state = createToolSessionState();
    const result = await executeTool(
      'read',
      { path: '../outside.txt' },
      context(),
      state,
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toBe('path escapes root: ../outside.txt');
  });

  it('round-trips CRLF files and keeps untouched lines', async () => {
    const file = join(root, 'crlf.txt');
    await writeFile(file, 'one' + CRLF + 'alpha' + CRLF + 'three' + CRLF);
    const state = createToolSessionState();
    const read = await executeTool('read', { path: 'crlf.txt' }, context(), state, deps);
    expect(read.isError).toBe(false);
    expect(read.output).toBe('1: one' + LF + '2: alpha' + LF + '3: three');

    const edit = await executeTool(
      'edit',
      { path: 'crlf.txt', old_string: 'alpha', new_string: 'beta' },
      context(),
      state,
      deps,
    );
    expect(edit.isError).toBe(false);
    expect(edit.output).toBe('edited crlf.txt: replaced 1 occurrence(s)');
    const bytes = await readFile(file, 'utf8');
    expect(bytes).toBe('one' + CRLF + 'beta' + CRLF + 'three' + CRLF);
  });

  it('rejects edits after the file changed', async () => {
    const file = join(root, 'changed.txt');
    await writeFile(file, 'alpha' + LF);
    const state = createToolSessionState();
    await executeTool('read', { path: 'changed.txt' }, context(), state, deps);
    await writeFile(file, 'alpha changed' + LF);
    const result = await executeTool(
      'edit',
      { path: 'changed.txt', old_string: 'alpha', new_string: 'beta' },
      context(),
      state,
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('file changed since read');
  });

  it('requires context for ambiguous matches', async () => {
    await writeFile(join(root, 'dup.txt'), 'same' + LF + 'same' + LF);
    const state = createToolSessionState();
    await executeTool('read', { path: 'dup.txt' }, context(), state, deps);
    const result = await executeTool(
      'edit',
      { path: 'dup.txt', old_string: 'same', new_string: 'other' },
      context(),
      state,
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('add surrounding context');
  });
});

describe('write, glob, and grep', () => {
  it('preserves the existing EOL on write', async () => {
    const file = join(root, 'eol.txt');
    await writeFile(file, 'old' + CRLF);
    const result = await executeTool(
      'write',
      { path: 'eol.txt', content: 'a' + LF + 'b' + LF },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('a' + CRLF + 'b' + CRLF);
  });

  it('writes new files with LF', async () => {
    const result = await executeTool(
      'write',
      { path: 'nested/new.txt', content: 'x' + LF },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(false);
    expect(await readFile(join(root, 'nested', 'new.txt'), 'utf8')).toBe('x' + LF);
  });

  it('lists files with forward slashes', async () => {
    await writeFile(join(root, 'a.ts'), '');
    await writeFile(join(root, 'b.js'), '');
    const result = await executeTool(
      'glob',
      { pattern: '**/*.ts' },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toBe('a.ts');
  });

  it('finds matches with grep and reports line numbers', async () => {
    await writeFile(join(root, 'grep.txt'), 'alpha' + LF + 'beta' + LF);
    const result = await executeTool(
      'grep',
      { pattern: 'beta' },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toBe('grep.txt:2: beta');
  });

  it('returns an error for an invalid regex', async () => {
    const result = await executeTool(
      'grep',
      { pattern: '(' },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('invalid regular expression');
  });
});

describe('bash', () => {
  it('runs a command and captures output', async () => {
    const result = await executeTool(
      'bash',
      { command: 'echo hello' },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain('hello');
  });

  it('kills a command that exceeds the timeout', async () => {
    const command = process.platform === 'win32' ? 'ping -n 6 127.0.0.1 >nul' : 'sleep 5';
    const started = Date.now();
    const result = await executeTool(
      'bash',
      { command, timeout_ms: 1000 },
      context(),
      createToolSessionState(),
      deps,
    );
    const elapsed = Date.now() - started;
    expect(result.isError).toBe(true);
    expect(result.output).toContain('timed out');
    expect(elapsed).toBeLessThan(4000);
  });
});

describe('classifyTool', () => {
  it('allows read tools in every mode', () => {
    expect(classifyTool('read', {}, 'read-only')).toBe('allow');
    expect(classifyTool('glob', {}, 'read-only')).toBe('allow');
    expect(classifyTool('grep', {}, 'read-only')).toBe('allow');
  });

  it('asks for writes in ask mode and allows them in accept-edits', () => {
    expect(classifyTool('write', {}, 'ask')).toBe('approve');
    expect(classifyTool('write', {}, 'accept-edits')).toBe('allow');
    expect(classifyTool('bash', {}, 'accept-edits')).toBe('approve');
    expect(classifyTool('write', {}, 'read-only')).toBe('deny');
  });

  it('asks before destructive commands in full-auto', () => {
    expect(classifyTool('bash', { command: 'rm -rf /' }, 'full-auto')).toBe('approve');
    expect(classifyTool('bash', { command: 'echo hi' }, 'full-auto')).toBe('allow');
  });
});
