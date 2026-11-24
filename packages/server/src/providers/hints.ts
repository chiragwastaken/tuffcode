/** Install guidance shared by provider probes and the login flow. */
export const HINTS = {
  claude: 'Install Claude Code, then run claude auth login.',
  codex:
    'Codex CLI not found. Install it with `npm install -g @openai/codex`, then run `codex login`.',
  opencode: 'Install OpenCode (`npm install -g opencode-ai`) so that `opencode` is on PATH.',
  acp: 'Install an ACP agent such as `agy` or `opencode`, or set the provider config `command`.',
  anthropic: 'Add an Anthropic API key from console.anthropic.com.',
} as const;
