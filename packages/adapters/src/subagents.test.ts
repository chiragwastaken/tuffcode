import type {
  AdapterDeps,
  AdapterLogger,
  SubagentToolRequest,
  TurnContext,
} from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { toAnthropicTools } from './anthropic/client.js';
import { toOpenAITools } from './openai/client.js';
import { classifySubagentTool, createToolSessionState, executeTool } from './openai/tools.js';
import { allowedToolSchemas } from './tool-policy.js';

const logger: AdapterLogger = { debug() {}, info() {}, warn() {}, error() {} };

function context(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    turnId: 'turn_1',
    cwd: 'C:/worktrees/parent',
    systemPrompt: 'You are Tuffcode.',
    permissionMode: 'accept-edits',
    model: 'test-model',
    brainSlice: '',
    attachments: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

function toolNames(tools: unknown[]): string[] {
  return tools.map((tool) => {
    if (typeof tool !== 'object' || tool === null) return '';
    if ('function' in tool && typeof tool.function === 'object' && tool.function !== null) {
      return 'name' in tool.function && typeof tool.function.name === 'string'
        ? tool.function.name
        : '';
    }
    return 'name' in tool && typeof tool.name === 'string' ? tool.name : '';
  });
}

describe('subagent harness tool', () => {
  it('appears in both harness tool lists only when offered', () => {
    expect(toolNames(toOpenAITools())).not.toContain('subagent');
    expect(toolNames(toAnthropicTools())).not.toContain('subagent');
    expect(toolNames(toOpenAITools(undefined, { subagent: true }))).toContain('subagent');
    expect(toolNames(toAnthropicTools(undefined, { subagent: true }))).toContain('subagent');
    expect(allowedToolSchemas(['read'], { subagent: true }).map((tool) => tool.name)).toEqual([
      'read',
      'subagent',
    ]);
  });

  it('serializes the type, task, and optional model schema', () => {
    const tools = toOpenAITools(undefined, { subagent: true });
    const subagent = tools.find((tool) => toolNames([tool])[0] === 'subagent');
    expect(subagent).toMatchObject({
      type: 'function',
      function: {
        name: 'subagent',
        parameters: {
          type: 'object',
          required: ['type', 'task'],
          additionalProperties: false,
        },
      },
    });
  });

  it('spawns through the injected hook and returns the child id immediately', async () => {
    const requests: SubagentToolRequest[] = [];
    const deps: AdapterDeps = {
      logger,
      resolveCommand: async () => null,
      env: {},
      spawnSubagent: async (request) => {
        requests.push(request);
        return { childId: 'sub_1', status: 'queued' };
      },
    };
    const result = await executeTool(
      'subagent',
      { type: 'explorer', task: 'Map the parser', model: 'fast-model' },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain('sub_1');
    expect(requests).toEqual([
      { cwd: 'C:/worktrees/parent', type: 'explorer', task: 'Map the parser', model: 'fast-model' },
    ]);
  });

  it('rejects an unknown type and a read-only turn', async () => {
    const deps: AdapterDeps = {
      logger,
      resolveCommand: async () => null,
      env: {},
      spawnSubagent: () => Promise.resolve({ childId: 'sub_1', status: 'queued' }),
    };
    const invalid = await executeTool(
      'subagent',
      { type: 'janitor', task: 'Clean up' },
      context(),
      createToolSessionState(),
      deps,
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.output).toContain('explorer, reviewer, notetaker, worker, planner');

    expect(classifySubagentTool('read-only')).toBe('deny');
    expect(classifySubagentTool('ask')).toBe('approve');
    expect(classifySubagentTool('full-auto')).toBe('allow');
  });

  it('reports a missing hook instead of throwing', async () => {
    const result = await executeTool(
      'subagent',
      { type: 'planner', task: 'Plan the work' },
      context(),
      createToolSessionState(),
      { logger, resolveCommand: async () => null, env: {} },
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('unavailable');
  });
});
