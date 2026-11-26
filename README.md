# Tuffcode

Local-first desktop app for agentic coding on Windows. One window, many agents, your machine.

Tuffcode runs coding agents against your real repositories in isolated git worktrees. It uses
the provider CLIs already installed on your machine or any OpenAI-compatible endpoint, and
keeps projects, threads, diffs, memory, and terminals in one Electron window.

## Features

- **Projects and threads.** Add any git repository, then run several threads per project side
  by side.
- **Git worktrees.** Every thread gets its own worktree on a `tuffcode/<threadId>` branch, so
  agents never collide with your checkout or with each other.
- **Providers.** Claude subscription through the installed CLI, ChatGPT subscription through
  Codex, Anthropic API keys, OpenAI-compatible endpoints (OpenRouter, DeepSeek, Kimi, Groq,
  Mistral, xAI, Together, Gemini), local models (Ollama, LM Studio, vLLM), and ACP agents.
  Keys stay in the desktop process and are sealed with Electron `safeStorage`.
- **Model discovery.** Every provider lists its real models, including context window, max
  output, vision and reasoning metadata when the endpoint reports it. Pick one from the composer
  popup or settings; refresh on demand; type a model id when a gateway returns nothing. The
  provider form has an Advanced section for the same values.
- **Modes.** Work, Plan, and Council, plus read-only, ask, accept-edits, and full-auto
  permissions. Work and Council switch from the centered app topbar.
- **Subagents.** Explorer, reviewer, notetaker, worker, and planner types, each with its own
  prompt, model, and fallback model. Child threads nest under their parent in the sidebar and
  stream into a side pane; workers get isolated worktrees. The dock above the composer is a
  compact chip row, not a second conversation.
- **Activity.** A top-right button opens the running tool calls, subagents, finished commands
  and waiting items, with output tails and a click through to each child.
- **Council.** A planner splits a goal into tasks, workers run in parallel child threads, and a
  reviewer from another model family checks each change before a pull request opens.
- **Brain.** Typed memory entries selected per turn, a kill switch, standing-rule capture, typed
  links, a live prompt preview with injected entry ids, an interactive node graph, and memory
  search and add tools for the agent.
- **MCP.** Local stdio and remote HTTP MCP servers are managed in Settings > MCP. Connectors
  support three auth modes: none, a bearer token or API key with a custom header, and browser
  OAuth 2.1 with PKCE, discovery, dynamic client registration, a loopback callback and automatic
  refresh. Tokens live in the OS keychain. The built-in harness reaches them through one `mcp`
  tool, and Claude subscription threads receive the same servers through the Agent SDK. Codex
  keeps its own MCP configuration.
- **Self-configuration.** A built-in `edit-tuffcode` skill loads automatically when you ask
  Tuffcode to change itself. The agent can add a provider or model, add an MCP server and change
  an allowlisted setting through a `config` tool, and a credential you give it in chat is written
  to the OS keychain and redacted from tool events. `/reload` refreshes providers, models,
  connectors, skills, commands and settings without a restart.
- **Diff review.** Changed files grouped by directory, real file line numbers, inline review
  comments, checkpoint comparison, and a collapsible file tree.
- **Timeline.** Reasoning, prose, grouped tool calls with results and diffs, and a final answer,
  with copy, retry, edit, and right-click actions. A finished turn folds its pre-answer work into
  one `Ran N tools and thought for Xs` row that expands to the exact original order. History is
  lossless: every event page replays, deltas coalesce, and tool calls and turn boundaries are
  never evicted.
- **Search.** `Ctrl+F` searches the active conversation, including text inside collapsed steps and
  tool groups, expands what it needs, scrolls the virtualized timeline and highlights matches. The
  agent's `grep` tool prefers ripgrep with a fast parallel fallback and can list files or counts.
- **Stop and send.** Stop settles the turn once with a visible boundary, and an immediate Send
  starts a clean new turn instead of merging or colliding. The Thinking spinner always clears.
- **Panes.** Up to four nested tiles, side by side or stacked, created by dragging a tab, a pane or
  a sidebar chat onto an edge drop zone. Dividers resize, double-click resets, and every tile is a
  full session surface with its own thread, composer, model and permission controls.
- **Terminal.** ConPTY terminals through `node-pty`, with tabs and `pwsh.exe`,
  `powershell.exe`, or `cmd.exe` as the shell. Scrollback, font size and cursor style apply live.
- **Approvals and checkpoints.** Tool calls that need consent render as approval cards, and
  thread checkpoints snapshot the worktree.
- **Settings.** Providers, models, subagent models, custom instructions, appearance, agents and
  tools, permissions, terminal, brain, updates, diagnostics, capabilities, notifications,
  keybindings. Notifications has a test trigger that reports whether Windows showed the banner.
- **Installer.** A per-user NSIS installer for Windows x64. Packaged builds check for updates on
  launch, download in the background, and ask you to restart when it is ready.

v0.3.2 repairs existing model capability rows so the Vision toggle applies, raises and exposes the
bash idle window, falls back to the project folder when a folder thread path is missing, and makes
the release workflow publish reliably. v0.3.1 fixes explorer tools, provider token compatibility,
council models and failure text, terminal truth, and makes new chats open in the project folder
with an optional worktree; it adds the Needs you inbox and project rules discovery. v0.3.0 added
lossless history, reliable Stop, folded steps, Ctrl+F, fast grep, no iteration cap, the
edit-tuffcode skill, /reload, MCP OAuth and nested tiles. v0.2.0 added the Claude Desktop parity
workspace, the plugins hub and image attachments. v0.1.3 added nested subagents, the Activity
panel, model metadata, MCP, self-configuration, brain links and a rewritten prompt set.

The full shipped, next and deferred feature list is in [docs/features.md](./docs/features.md).

## Requirements

- Windows 10 1809 or newer (x64)
- Node.js 24 or newer
- pnpm 11 (`corepack enable` then `pnpm install`)

Node and pnpm are needed to build from source. The installer is self-contained.

## Install

Download `Tuffcode-Setup-<version>.exe` from the
[latest release](https://github.com/tuffcode-net/tuffcode/releases/latest) and run it. The
installer is per-user and does not require elevation. Unsigned builds can trigger SmartScreen;
see [docs/install.md](./docs/install.md) for silent install, code signing, and troubleshooting.

## Build from source

```powershell
pnpm install
pnpm build:server   # bundle the server to packages/server/dist/server.js
pnpm build:win      # Electron bundles and the NSIS installer
```

`pnpm build:win` does not rebuild the server bundle, so run `pnpm build:server` first. The
installer lands in `apps/desktop/dist/Tuffcode-Setup-<version>.exe`. For development,
`pnpm dev` runs the Electron app with hot reload and uses the TypeScript sources directly.

## Test

```powershell
pnpm test       # Vitest unit and integration tests
pnpm test:e2e   # Playwright Electron suite, builds both artifacts first
pnpm check      # typecheck, lint, and emdash scan
```

## Architecture

- `apps/desktop`: Electron main and preload. Starts the server in `utilityProcess.fork()`,
  seals secrets with `safeStorage`, and exposes a narrow IPC bridge.
- `packages/server`: all Node-side logic: WebSocket server, SQLite, runner, git, PTY, brain,
  council, providers, commands, and skills.
- `apps/web`: React renderer. It has no Node builtins and reaches the server only over one
  loopback WebSocket carrying a typed JSON envelope: requests are `{ id, method, params }`,
  responses are `{ id, ok, result }` or `{ id, ok: false, error }`, and server pushes are
  `{ kind: 'event', type, ... }` frames. Zod validates every frame.
See [docs/architecture.md](./docs/architecture.md) for the process model, wire protocol, prompt
assembly, subagents and testing.

- `packages/contracts` (Zod schemas and wire types), `packages/adapters` (Claude, Codex, ACP,
  OpenAI-compatible), `packages/prompt` (system prompt, tools, council prompts), `packages/ui`
  (design system), `packages/shared` (paths, ids, logger, Windows helpers).

The server listens on `127.0.0.1` with an OS-assigned port and writes the port plus a bearer
token to `~/.tuffcode/server.json`. Data lives in `%LOCALAPPDATA%\Tuffcode` (`tuffcode.db`,
logs, worktrees). See [AGENTS.md](./AGENTS.md) for contribution rules.

## License

MIT. See [LICENSE](./LICENSE).
