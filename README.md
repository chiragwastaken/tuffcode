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
- **Model discovery.** Every provider lists its real models. Pick one from the composer popup or
  settings; refresh on demand; type a model id when a gateway returns nothing.
- **Modes.** Work, Plan, and Council, plus read-only, ask, accept-edits, and full-auto
  permissions. Work and Council switch from the thread topbar.
- **Subagents.** Explorer, reviewer, notetaker, worker, and planner types, each with its own
  prompt, model, and fallback model. Children stream into a side pane; workers get isolated
  worktrees.
- **Council.** A planner splits a goal into tasks, workers run in parallel child threads, and a
  reviewer from another model family checks each change before a pull request opens.
- **Brain.** Typed memory entries selected per turn, a live prompt preview, an interactive node
  graph, and a memory search tool for the agent.
- **Diff review.** Changed files grouped by directory, real file line numbers, inline review
  comments, checkpoint comparison, and a collapsible file tree.
- **Timeline.** Reasoning, prose, grouped tool calls with results and diffs, and a final answer,
  with copy, retry, edit, and right-click actions.
- **Panes.** Two or three resizable panes per thread for the conversation, subagents, diff,
  terminal, or brain.
- **Terminal.** ConPTY terminals through `node-pty`, with tabs and `pwsh.exe`,
  `powershell.exe`, or `cmd.exe` as the shell.
- **Approvals and checkpoints.** Tool calls that need consent render as approval cards, and
  thread checkpoints snapshot the worktree.
- **Settings.** Providers, models, subagent models, custom instructions, appearance, agents and
  tools, permissions, terminal, brain, updates, diagnostics, capabilities, keybindings.
- **Installer.** A per-user NSIS installer for Windows x64, with optional auto-update.

Model discovery, subagents, split panes and the brain graph land in v0.1.2. v0.1.1 ships the
provider gallery, settings, persisted turns and the diff and timeline rework.

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
