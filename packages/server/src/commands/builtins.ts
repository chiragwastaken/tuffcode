import type { CommandDefinition } from './types.js';

/**
 * Commands the server handles itself. They appear in the palette before project
 * commands and cannot be shadowed by a markdown file.
 */
export const BUILT_IN_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'model',
    description: 'Switch the model for this thread',
    body: '',
    path: null,
    argumentHint: '<model>',
  },
  {
    name: 'compact',
    description: 'Compact the conversation to free context',
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
    name: 'plan',
    description: 'Switch to plan mode and draft a plan',
    body: '',
    path: null,
    argumentHint: '[goal]',
  },
  {
    name: 'council',
    description: 'Start a council run with parallel workers',
    body: '',
    path: null,
    argumentHint: '<goal>',
  },
  {
    name: 'goal',
    description: 'Set or update the goal for this thread',
    body: '',
    path: null,
    argumentHint: '<goal>',
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
