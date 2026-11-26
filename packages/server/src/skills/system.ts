/**
 * Skills that ship inside Tuffcode itself. They are always discoverable, they come
 * first in every list, and a project, user or plugin skill cannot shadow them. Their
 * bodies live in this module, so discovery never reads a file for them.
 */
export const SELF_CONFIG_SKILL = 'edit-tuffcode';

const SYSTEM_PATH_PREFIX = 'system:';

export interface SystemSkill {
  name: string;
  description: string;
  body: string;
}

const EDIT_TUFFCODE_BODY = `# edit-tuffcode

Tuffcode's own configuration and source are yours to change, but only through the paths below.

## Configuration changes
- Route every provider, model, MCP server and settings change through the \`config\` tool. Actions: \`provider.add\`, \`provider.model.add\`, \`mcp.add\`, \`settings.set\`.
- Pass a user-supplied credential as the config tool's secret field: \`secret\` (alias \`apiKey\`) for \`provider.add\`, \`token\` for an \`http\` MCP server, and \`secretEnv\` as a JSON object for a \`stdio\` server. The server writes these to the OS keychain, never to SQLite.
- Never print, echo, log or repeat a credential, and never put one in \`env\`, a tool result, a commit message or a file. If secret storage is unavailable the tool says so: tell the user to set the key in Settings > Providers or Settings > MCP env instead.
- Keep plain \`env\` free of secret-shaped names. The tool rejects keys such as \`GITHUB_TOKEN\` there on purpose, so a token can never land in the database through \`env\`.
- After a configuration change the next turn already sees it. Tell the user they can run \`/reload\` if a surface still shows stale state.

## Source changes
- Edit Tuffcode source only inside this thread's worktree, never the main checkout.
- Read the file and its callers first, then follow the pattern the file already uses.
- Verify with the narrowest targeted test, then run \`pnpm check\` before you report.`;

export const SYSTEM_SKILLS: readonly SystemSkill[] = [
  {
    name: SELF_CONFIG_SKILL,
    description:
      'Change Tuffcode configuration through the config tool and edit Tuffcode source safely: keychain secrets, worktree only, targeted tests then pnpm check.',
    body: EDIT_TUFFCODE_BODY,
  },
];

/** The synthetic path a system skill reports, so listings stay uniform. */
export function systemSkillPath(name: string): string {
  return `${SYSTEM_PATH_PREFIX}${name}`;
}

export function isSystemSkillPath(path: string): boolean {
  return path.startsWith(SYSTEM_PATH_PREFIX);
}

export function systemSkill(name: string): SystemSkill | undefined {
  return SYSTEM_SKILLS.find((skill) => skill.name === name);
}

/** The body behind a system skill path, or undefined when the name is unknown. */
export function systemSkillBody(path: string): string | undefined {
  if (!isSystemSkillPath(path)) return undefined;
  return systemSkill(path.slice(SYSTEM_PATH_PREFIX.length))?.body;
}

/**
 * Verbs that ask for a configuration change, paired with the objects the config tool
 * owns. Both halves must appear in one sentence, so an ordinary request such as
 * "how do I run the preview" never loads the skill.
 */
const CONFIG_VERB =
  '(?:add|install|connect|register|configure|set\\s*up|wire|enable|change|set|update|switch|toggle|adjust|remove|delete)';
const CONFIG_TARGET =
  '(?:mcp(?:\\s+servers?)?|providers?|models?|connectors?|settings|permission\\s+mode|base\\s*url|api\\s*key)';

/** Messages that ask to change Tuffcode itself or its configuration. */
const SELF_CONFIG_PATTERNS: readonly RegExp[] = [
  /\b(?:edit|change|modify|patch|fix|update|add|implement|refactor|remove)\b[^.\n]{0,60}\btuffcode\b/i,
  /\btuffcode\b[^.\n]{0,60}\b(?:topbar|sidebar|composer|worktree|settings|source|codebase|repository|repo|prompt)\b/i,
  new RegExp(`\\b${CONFIG_VERB}\\b[^.\\n]{0,80}\\b${CONFIG_TARGET}\\b`, 'i'),
  /\bconfig\s+tool\b/i,
  /\bupdate\s+(?:the\s+)?settings\b/i,
  /\bdefault\s+permission\s+mode\b/i,
];

/**
 * True when the user message asks to change Tuffcode or its configuration, which is
 * when the full `edit-tuffcode` body is injected for the turn. Deliberately narrow:
 * a message must name both an action and a Tuffcode surface or config object.
 */
export function matchesSelfConfigIntent(message: string): boolean {
  return SELF_CONFIG_PATTERNS.some((pattern) => pattern.test(message));
}
