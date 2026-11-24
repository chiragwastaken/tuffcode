import type { CommandDefinition } from './types.js';

/**
 * Commands the server handles itself. They appear in the palette before project
 * commands and cannot be shadowed by a markdown file. Each one is backed by a real
 * service through `commands.run`; there are no placeholder entries.
 */
export const BUILT_IN_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'model',
    description: 'Switch the model for this thread',
    body: '',
    path: null,
    argumentHint: null,
  },
  {
    name: 'plan',
    description: 'Switch to plan mode and draft a plan',
    body: '',
    path: null,
    argumentHint: '[goal]',
  },
  {
    name: 'council',
    description: 'Switch to council mode and start a goal',
    body: '',
    path: null,
    argumentHint: '<goal>',
  },
  {
    name: 'subagent',
    description: 'Spawn a typed subagent with a task',
    body: '',
    path: null,
    argumentHint: '<type> <task>',
  },
  {
    name: 'prompt',
    description: 'Edit the instructions injected into every turn',
    body: '',
    path: null,
    argumentHint: null,
  },
  {
    name: 'context',
    description: 'Show the prompt sections and token budget',
    body: '',
    path: null,
    argumentHint: null,
  },
  {
    name: 'agents',
    description: 'List subagent types and their configured models',
    body: '',
    path: null,
    argumentHint: null,
  },
  {
    name: 'compact',
    description: 'Fold older messages into one summary row',
    body: '',
    path: null,
    argumentHint: '[instructions]',
  },
  {
    name: 'clear',
    description: 'Clear this thread and start fresh',
    body: '',
    path: null,
    argumentHint: null,
  },
  {
    name: 'help',
    description: 'List available commands and skills',
    body: '',
    path: null,
    argumentHint: '[command]',
  },
];

export const BUILT_IN_NAMES: ReadonlySet<string> = new Set(
  BUILT_IN_COMMANDS.map((command) => command.name),
);
