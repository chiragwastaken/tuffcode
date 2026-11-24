import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  listClaudeModels,
  type ClaudeModelInfo,
  type ClaudeModelQuery,
  type ClaudeModelQueryParams,
} from './models.js';

function fakeQuery(
  calls: ClaudeModelQueryParams[],
  infos: ClaudeModelInfo[],
  interrupt?: () => Promise<unknown>,
): (params: ClaudeModelQueryParams) => ClaudeModelQuery {
  return (params) => {
    calls.push(params);
    return {
      supportedModels: async () => infos,
      ...(interrupt === undefined ? {} : { interrupt }),
    };
  };
}

describe('listClaudeModels', () => {
  it('maps SDK model rows, dedupes ids, and falls back to the id as label', async () => {
    const calls: ClaudeModelQueryParams[] = [];
    const rows = await listClaudeModels({
      pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
      queryFn: fakeQuery(calls, [
        { value: 'sonnet', displayName: 'Sonnet' },
        { id: 'opus', displayName: 'Opus' },
        { value: 'sonnet', displayName: 'duplicate' },
        { value: '   ', displayName: 'blank' },
        { value: 'haiku' },
      ]),
    });

    expect(rows).toEqual([
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
      { id: 'haiku', label: 'haiku' },
    ]);
  });

  it('runs one short-lived query with the resolved executable and closes it', async () => {
    const calls: ClaudeModelQueryParams[] = [];
    let interrupted = false;
    await listClaudeModels({
      pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
      cwd: 'D:/repo',
      queryFn: fakeQuery(calls, [], async () => {
        interrupted = true;
      }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      prompt: '',
      options: {
        cwd: 'D:/repo',
        pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
        permissionMode: 'default',
        persistSession: false,
      },
    });
    expect(calls[0]?.options.abortController.signal.aborted).toBe(true);
    expect(interrupted).toBe(true);
  });

  it('aborts the query when it outlives the timeout', async () => {
    const calls: ClaudeModelQueryParams[] = [];
    await expect(
      listClaudeModels({
        pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
        timeoutMs: 5,
        queryFn: (params) => {
          calls.push(params);
          return {
            supportedModels: async () => {
              await once(params.options.abortController.signal, 'abort');
              throw new Error('aborted');
            },
          };
        },
      }),
    ).rejects.toThrow('aborted');
    expect(calls[0]?.options.abortController.signal.aborted).toBe(true);
  });

  it('surfaces a failing query to the caller', async () => {
    await expect(
      listClaudeModels({
        pathToClaudeCodeExecutable: 'C:/tools/claude.exe',
        queryFn: () => ({
          supportedModels: async () => {
            throw new Error('CLI exited 1');
          },
        }),
      }),
    ).rejects.toThrow('CLI exited 1');
  });
});
