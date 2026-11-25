import type { McpServer } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildMcpUpsertParams,
  emptyMcpDraft,
  mcpDraftFromServer,
  parseMcpArgs,
  parseMcpEnv,
  validateMcpDraft,
  type McpDraft,
} from './mcp-form';

function draft(overrides: Partial<McpDraft> = {}): McpDraft {
  return {
    label: 'Filesystem',
    command: 'npx',
    args: '',
    env: '',
    cwd: '',
    enabled: true,
    ...overrides,
  };
}

const server: McpServer = {
  id: 'mcp-1',
  label: 'Filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/work'],
  env: { TOKEN: 'abc' },
  cwd: 'C:/work',
  enabled: true,
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
};

describe('validateMcpDraft', () => {
  it('accepts a minimal server', () => {
    expect(validateMcpDraft(draft())).toEqual({});
  });

  it('requires a label and a command', () => {
    expect(validateMcpDraft(draft({ label: '   ', command: '  ' }))).toEqual({
      label: 'Label is required.',
      command: 'Command is required.',
    });
  });

  it('rejects env text that is not JSON', () => {
    expect(validateMcpDraft(draft({ env: 'TOKEN=abc' }))).toEqual({
      env: 'Environment must be valid JSON.',
    });
  });

  it('rejects env JSON that is not an object', () => {
    expect(validateMcpDraft(draft({ env: '["TOKEN"]' }))).toEqual({
      env: 'Environment must be a JSON object.',
    });
  });

  it('rejects env values that are not strings', () => {
    expect(validateMcpDraft(draft({ env: '{"TOKEN": 7}' }))).toEqual({
      env: 'Environment value for TOKEN must be a string.',
    });
  });

  it('rejects a relative working directory', () => {
    expect(validateMcpDraft(draft({ cwd: 'work/server' }))).toEqual({
      cwd: 'Enter an absolute path.',
    });
  });

  it('accepts absolute Windows, POSIX, and home working directories', () => {
    expect(validateMcpDraft(draft({ cwd: 'C:\\work\\server' }))).toEqual({});
    expect(validateMcpDraft(draft({ cwd: 'C:/work/server' }))).toEqual({});
    expect(validateMcpDraft(draft({ cwd: '/srv/server' }))).toEqual({});
    expect(validateMcpDraft(draft({ cwd: '~/server' }))).toEqual({});
  });
});

describe('parseMcpArgs', () => {
  it('splits on spaces and newlines and trims the result', () => {
    expect(parseMcpArgs(' -y  @modelcontextprotocol/server-filesystem\nC:/work ')).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      'C:/work',
    ]);
  });

  it('returns no arguments for blank input', () => {
    expect(parseMcpArgs('   \n  ')).toEqual([]);
  });
});

describe('parseMcpEnv', () => {
  it('treats blank input as no variables', () => {
    expect(parseMcpEnv('  ')).toEqual({ env: {} });
  });

  it('parses a JSON object of strings', () => {
    expect(parseMcpEnv('{"TOKEN":"abc","ROOT":"C:/work"}')).toEqual({
      env: { TOKEN: 'abc', ROOT: 'C:/work' },
    });
  });

  it('reports invalid JSON and non-object values', () => {
    expect(parseMcpEnv('nope')).toEqual({ error: 'Environment must be valid JSON.' });
    expect(parseMcpEnv('null')).toEqual({ error: 'Environment must be a JSON object.' });
    expect(parseMcpEnv('{"TOKEN": 7}')).toEqual({
      error: 'Environment value for TOKEN must be a string.',
    });
  });
});

describe('buildMcpUpsertParams', () => {
  it('trims fields and builds the args array and env object', () => {
    expect(
      buildMcpUpsertParams(
        draft({
          label: ' Filesystem ',
          command: ' npx ',
          args: '-y @modelcontextprotocol/server-filesystem C:/work',
          env: '{"TOKEN":"abc"}',
          cwd: ' C:/work ',
        }),
      ),
    ).toEqual({
      label: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/work'],
      env: { TOKEN: 'abc' },
      cwd: 'C:/work',
      enabled: true,
    });
  });

  it('carries the id and the disabled state when editing', () => {
    expect(buildMcpUpsertParams(draft({ id: 'mcp-1', enabled: false }))).toMatchObject({
      id: 'mcp-1',
      enabled: false,
    });
  });

  it('sends a null working directory when the field is empty', () => {
    expect(buildMcpUpsertParams(draft({ cwd: '   ' }))).toMatchObject({ cwd: null });
  });

  it('throws on invalid env JSON instead of dropping it', () => {
    expect(() => buildMcpUpsertParams(draft({ env: '[]' }))).toThrow(
      'Environment must be a JSON object.',
    );
  });
});

describe('mcpDraftFromServer', () => {
  it('formats arguments one per line and the env as JSON', () => {
    expect(mcpDraftFromServer(server)).toEqual({
      id: 'mcp-1',
      label: 'Filesystem',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-filesystem\nC:/work',
      env: '{\n  "TOKEN": "abc"\n}',
      cwd: 'C:/work',
      enabled: true,
    });
  });

  it('starts a blank draft for a new server', () => {
    expect(emptyMcpDraft()).toEqual({
      label: '',
      command: '',
      args: '',
      env: '',
      cwd: '',
      enabled: true,
    });
  });
});
