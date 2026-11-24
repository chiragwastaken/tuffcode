/**
 * JSON Schema definitions for the six harness tools.
 *
 * These are plain data, not zod schemas, so they serialize directly into a
 * model request and stay under the token budget. The server validates calls
 * against the same shapes.
 */

export const TOOL_NAMES = ['bash', 'read', 'edit', 'write', 'glob', 'grep'] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolParameterType = 'string' | 'integer' | 'boolean';

export interface ToolParameterSchema {
  type: ToolParameterType;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterSchema>;
  required: string[];
  additionalProperties: false;
}

export interface ToolSchema {
  name: ToolName;
  description: string;
  parameters: ToolParameters;
}

export const TOOL_SCHEMAS: readonly ToolSchema[] = [
  {
    name: 'bash',
    description:
      'Run a shell command in the worktree. Use for builds, tests, git, and process control. Output is capped and a timeout kills the process tree.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line to execute.' },
        timeout_ms: {
          type: 'integer',
          description: 'Timeout in milliseconds. Default 120000.',
          minimum: 1000,
          maximum: 600000,
        },
        cwd: { type: 'string', description: 'Working directory, relative to the worktree root.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'read',
    description:
      'Read a UTF-8 text file and return numbered lines. Required before editing. Use offset and limit to page through large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the worktree root.' },
        offset: { type: 'integer', description: 'First line to return, 1-based.', minimum: 1 },
        limit: {
          type: 'integer',
          description: 'Maximum lines to return.',
          minimum: 1,
          maximum: 2000,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit',
    description:
      'Replace an exact string in a file. Fails when old_string is missing or matches more than once; add surrounding context to disambiguate. Read the file first.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the worktree root.' },
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every match instead of requiring exactly one.',
          default: false,
        },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  {
    name: 'write',
    description:
      'Create a file or replace its entire contents. Parent directories are created. Refuses paths outside the worktree root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the worktree root.' },
        content: { type: 'string', description: 'Full file contents.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'glob',
    description:
      'List files matching a glob pattern, newest first. Use to locate files by name or extension. Results are capped at 200.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob such as src/**/*.ts.' },
        path: {
          type: 'string',
          description: 'Directory to search. Defaults to the worktree root.',
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'grep',
    description:
      'Search file contents with a regular expression. Returns path, line number, and matching line. Results are capped at 200.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: { type: 'string', description: 'File or directory to search.' },
        glob: { type: 'string', description: 'Restrict files by glob, such as **/*.ts.' },
        case_sensitive: {
          type: 'boolean',
          description: 'Match case when true. Default true.',
          default: true,
        },
        max_results: {
          type: 'integer',
          description: 'Maximum matches to return.',
          minimum: 1,
          maximum: 200,
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
];
