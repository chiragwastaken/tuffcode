export interface ToolInfo {
  id: string;
  label: string;
  description: string;
}

/**
 * The six tools the built-in harness can call, in the order the prompt package
 * declares them. Keep this list in step with TOOL_NAMES in packages/prompt.
 */
export const TOOL_CATALOG: readonly ToolInfo[] = [
  {
    id: 'bash',
    label: 'Shell',
    description: 'Run a command in the thread worktree: builds, tests, git, and processes.',
  },
  {
    id: 'read',
    label: 'Read files',
    description: 'Open a file or list a directory before deciding what to change.',
  },
  {
    id: 'edit',
    label: 'Edit files',
    description: 'Replace a string in an existing file without rewriting the whole file.',
  },
  {
    id: 'write',
    label: 'Write files',
    description: 'Create a new file or overwrite one the agent already read.',
  },
  {
    id: 'glob',
    label: 'Find files',
    description: 'Match file paths by pattern to locate code.',
  },
  {
    id: 'grep',
    label: 'Search contents',
    description: 'Search file contents by regular expression.',
  },
];

const KNOWN_TOOL_IDS = new Set(TOOL_CATALOG.map((tool) => tool.id));

/**
 * Adds or removes a tool while keeping the stored list in catalog order, so the
 * settings row never reports a re-ordered list as a change. Ids this build does
 * not know are preserved at the end.
 */
export function toggleEnabledTool(
  enabled: readonly string[],
  toolId: string,
  nextEnabled: boolean,
): string[] {
  const selected = new Set(enabled);
  if (nextEnabled) selected.add(toolId);
  else selected.delete(toolId);

  const ordered = TOOL_CATALOG.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
  const unknown = enabled.filter((id) => !KNOWN_TOOL_IDS.has(id) && selected.has(id));
  return [...ordered, ...unknown];
}

/** Tool ids in the settings that this build cannot describe. */
export function unknownEnabledTools(enabled: readonly string[]): string[] {
  return enabled.filter((id) => !KNOWN_TOOL_IDS.has(id));
}
