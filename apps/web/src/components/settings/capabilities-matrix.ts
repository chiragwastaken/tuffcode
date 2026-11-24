/**
 * The capabilities comparison (spec section 4). Values are honest: our own
 * column claims only what this build does, and competitor cells are marked
 * partial wherever the feature depends on an extra tool or configuration.
 */
export const CAPABILITY_COLUMNS = [
  'tuffcode',
  'claude-code',
  'codex',
  'cursor',
  't3-code',
] as const;

export type CapabilityColumn = (typeof CAPABILITY_COLUMNS)[number];

export const CAPABILITY_COLUMN_LABEL: Record<CapabilityColumn, string> = {
  tuffcode: 'Tuffcode',
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  cursor: 'Cursor',
  't3-code': 'T3 Code',
};

export type CapabilityLevel = 'supported' | 'partial' | 'not-supported';

export const CAPABILITY_LEVEL_LABEL: Record<CapabilityLevel, string> = {
  supported: 'Supported',
  partial: 'Partial',
  'not-supported': 'Not supported',
};

export interface CapabilityCell {
  level: CapabilityLevel;
  note: string;
}

export interface CapabilityRow {
  id: string;
  feature: string;
  cells: Record<CapabilityColumn, CapabilityCell>;
}

function cell(level: CapabilityLevel, note: string): CapabilityCell {
  return { level, note };
}

export const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  {
    id: 'worktrees',
    feature: 'Parallel threads with worktrees',
    cells: {
      tuffcode: cell(
        'supported',
        'Every thread runs in its own git worktree under the worktree root.',
      ),
      'claude-code': cell(
        'partial',
        'Parallel sessions run, but creating worktrees is a manual git step.',
      ),
      codex: cell('not-supported', 'One session per directory; no worktree handling.'),
      cursor: cell('supported', 'The Agents Window runs tasks in isolated git worktrees.'),
      't3-code': cell('partial', 'Worktrees depend on the agent adapter; there is no worktree UI.'),
    },
  },
  {
    id: 'multi-provider',
    feature: 'Multi-provider in one app',
    cells: {
      tuffcode: cell(
        'supported',
        'Claude, Codex, ACP agents, OpenCode and OpenAI-compatible in one list.',
      ),
      'claude-code': cell('not-supported', 'Anthropic models only.'),
      codex: cell('partial', 'OpenAI models, plus OSS providers through config.'),
      cursor: cell('supported', 'Anthropic, OpenAI, Gemini, and your own API keys.'),
      't3-code': cell('supported', 'One adapter per vendor CLI, all in the same window.'),
    },
  },
  {
    id: 'subscription-login',
    feature: 'Subscription login reuse',
    cells: {
      tuffcode: cell(
        'supported',
        'Spawns the installed vendor CLIs, so their existing logins are reused.',
      ),
      'claude-code': cell('supported', 'Signing in with a Claude plan is the product.'),
      codex: cell('supported', 'Sign in with a ChatGPT plan.'),
      cursor: cell('supported', 'Uses the Cursor subscription.'),
      't3-code': cell('supported', 'Delegates sign-in to the installed CLIs.'),
    },
  },
  {
    id: 'openai-compatible',
    feature: 'Custom OpenAI-compatible endpoints',
    cells: {
      tuffcode: cell(
        'supported',
        'Any base URL, extra headers, and a key stored through the OS secret store.',
      ),
      'claude-code': cell('not-supported', 'No custom endpoint.'),
      codex: cell('partial', 'Provider entries in config.toml.'),
      cursor: cell('partial', 'Base URL override for OpenAI-compatible models.'),
      't3-code': cell('partial', 'Only where the adapter accepts a base URL.'),
    },
  },
  {
    id: 'local-models',
    feature: 'Local models',
    cells: {
      tuffcode: cell('supported', 'Point an OpenAI-compatible provider at Ollama or llama.cpp.'),
      'claude-code': cell('not-supported', 'No local inference.'),
      codex: cell('partial', 'OSS providers such as Ollama through --oss.'),
      cursor: cell('partial', 'Ollama and other local endpoints.'),
      't3-code': cell('partial', 'Adapter-dependent; no model browser.'),
    },
  },
  {
    id: 'council',
    feature: 'Cross-model council review',
    cells: {
      tuffcode: cell(
        'supported',
        'Several providers review one goal: read-only reviewers, full-auto worker.',
      ),
      'claude-code': cell('not-supported', 'One model per session.'),
      codex: cell('not-supported', 'One model per session.'),
      cursor: cell('not-supported', 'No cross-model review.'),
      't3-code': cell('not-supported', 'No council workflow.'),
    },
  },
  {
    id: 'brain',
    feature: 'Persistent brain',
    cells: {
      tuffcode: cell(
        'supported',
        'Rules and preferences in SQLite, retrieved and injected per turn.',
      ),
      'claude-code': cell('partial', 'CLAUDE.md memory files; no retrieval scoring.'),
      codex: cell('partial', 'AGENTS.md instructions per repository.'),
      cursor: cell('partial', 'Rules and saved memories.'),
      't3-code': cell('not-supported', 'No memory store.'),
    },
  },
  {
    id: 'diff-comments',
    feature: 'Diff review with inline comments',
    cells: {
      tuffcode: cell('supported', 'Comments are stored per file and line on the thread.'),
      'claude-code': cell('partial', 'Shows diffs; commenting happens in your editor.'),
      codex: cell('partial', 'Prints diffs; no comment threads.'),
      cursor: cell('supported', 'Review diffs and comment inside the editor.'),
      't3-code': cell('partial', 'Diff viewer per thread; comments depend on the adapter.'),
    },
  },
  {
    id: 'terminal',
    feature: 'In-app terminal',
    cells: {
      tuffcode: cell('supported', 'A node-pty terminal in the inspector, one per thread.'),
      'claude-code': cell('supported', 'Runs in your terminal and can run commands.'),
      codex: cell('supported', 'Runs in your terminal and can run commands.'),
      cursor: cell('supported', 'Integrated terminal in the editor.'),
      't3-code': cell('supported', 'Terminal panel backed by node-pty.'),
    },
  },
  {
    id: 'checkpoints',
    feature: 'Checkpoints and revert',
    cells: {
      tuffcode: cell('supported', 'Create a checkpoint, then revert the thread worktree to it.'),
      'claude-code': cell('supported', '/rewind returns to an earlier checkpoint.'),
      codex: cell('not-supported', 'No checkpoint store.'),
      cursor: cell('supported', 'Restore to a checkpoint from the chat.'),
      't3-code': cell('partial', 'Where the adapter exposes one.'),
    },
  },
  {
    id: 'draft-pr',
    feature: 'Draft PR creation',
    cells: {
      tuffcode: cell('supported', 'gh pr create --draft runs in the thread worktree.'),
      'claude-code': cell('partial', 'Through gh in the shell; no dedicated action.'),
      codex: cell('partial', 'Through gh in the shell; no dedicated action.'),
      cursor: cell('partial', 'Through the terminal; no dedicated action.'),
      't3-code': cell('partial', 'Adapter-dependent; no first-class PR flow.'),
    },
  },
  {
    id: 'slash-commands',
    feature: 'Slash commands',
    cells: {
      tuffcode: cell('supported', 'Built-in commands plus those discovered in the project.'),
      'claude-code': cell('supported', 'Built-in and custom slash commands.'),
      codex: cell('supported', 'Custom prompts invoked as slash commands.'),
      cursor: cell('supported', 'Slash commands in the chat.'),
      't3-code': cell('partial', 'Whatever the adapter forwards.'),
    },
  },
  {
    id: 'skills',
    feature: 'Markdown skills',
    cells: {
      tuffcode: cell(
        'supported',
        'SKILL.md packs from .tuffcode/skills and the user skills folder.',
      ),
      'claude-code': cell('supported', 'Skills shipped as markdown packs.'),
      codex: cell('partial', 'AGENTS.md only; no skill packs.'),
      cursor: cell('partial', '.cursor/rules markdown, no on-demand packs.'),
      't3-code': cell('partial', 'Adapter-dependent.'),
    },
  },
  {
    id: 'conpty',
    feature: 'Windows ConPTY',
    cells: {
      tuffcode: cell('supported', 'node-pty uses ConPTY on Windows; no WSL needed.'),
      'claude-code': cell('partial', 'Native Windows is limited; Git Bash or WSL recommended.'),
      codex: cell('partial', 'WSL recommended on Windows.'),
      cursor: cell('supported', 'Native Windows terminal.'),
      't3-code': cell('supported', 'Electron plus node-pty on Windows.'),
    },
  },
  {
    id: 'telemetry',
    feature: 'Telemetry-free',
    cells: {
      tuffcode: cell('supported', 'No analytics or crash-reporting dependencies.'),
      'claude-code': cell('partial', 'Usage telemetry, with an opt-out.'),
      codex: cell('supported', 'Open source; no telemetry by default.'),
      cursor: cell('not-supported', 'Product analytics are on by default.'),
      't3-code': cell('supported', 'Open source; no telemetry by default.'),
    },
  },
];

/** Gaps we are not closing yet, stated where the matrix is read. */
export const CAPABILITY_GAPS: readonly string[] = [
  'No cloud sync: threads, checkpoints and brain entries stay in this machine’s SQLite database.',
  'No mobile or web client; the desktop app is the only surface.',
  'No team accounts, sharing, or roles: one local user per install.',
  'No hosted relay: remote threads need a reachable server of your own.',
];
