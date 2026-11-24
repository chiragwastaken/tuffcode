# Changelog

All notable changes to Tuffcode are documented here. The format follows Keep a Changelog, and
the project uses semantic versioning.

## [Unreleased]

### Models and providers
- Model discovery for every provider kind: Claude subscription through the Agent SDK, Codex
  through app-server, Anthropic and OpenAI-compatible through their models endpoints, ACP
  through session config options.
- Searchable model popup in the composer and settings, with refresh and manual entry.

### Subagents and council
- Subagent types: explorer, reviewer, notetaker, worker, planner, each with its own prompt.
- Per-type model and fallback model in settings, concurrency cap, isolated worktrees for workers.
- Work and Council switch in the thread topbar; Council starts from one goal box.
- The inspector council tab follows that goal: board, status, cancel and details, plus a single
  switch button in work mode instead of a second goal form.

### Slash commands
- Composer slash commands execute real services through one `commands.run` RPC: the model
  picker, plan and council modes, typed subagents, custom instructions, the prompt budget,
  transcript clear and compact, and a command and skill listing.
- The palette shows argument hints, and unknown slash names fall through as normal messages.

### Composer and timeline
- Composer controls split left (mode, model) and right (attach, permission, send).
- The composer execution switch reads Build and Plan, so it cannot be confused with the topbar's
  Work and Council switch.
- The thread header gives the title the full row: the branch label hides under 1500px and the mode
  switch keeps an icon and a 12px label.
- Timeline renders reasoning, prose, grouped tool calls and the final answer, with copy, retry,
  edit and right-click actions.
- Split panes with draggable splitters and persisted layout.

### Memory and settings
- Context meter, per-model context window and max output tokens, warning threshold,
  auto-compaction, and GitHub Copilot and Azure OpenAI presets.
- Council node board with planner, task, reviewer and report nodes.
- Custom instructions injected per turn within budget, with a prompt preview.
- Interactive brain graph and a memory search tool.
- Light mode caption buttons and window chrome follow the theme.
- Sidebar lists projects and threads only.
- Slash commands now execute real services: /model, /plan, /council, /subagent, /prompt,
  /context, /agents, /clear, /compact, /help.
- Subagent pane with cards, connector line, tabs and cancel; strip when closed.
- Council node board with dependency edges and click-through, restored after reload via council.latest.
- Split panes: two or three resizable panes per thread with draggable splitters, tab drag between panes, keyboard shortcuts and persisted layout.

## [0.1.1] - 2026-11-24

### Shell and settings

- Redesigned shell with a caption-safe titlebar and a connection popover that shows status,
  port, and version.
- Full-width settings with 12 sections: Appearance, Providers, Models, Agents and tools,
  Permissions, Terminal, Brain, Updates, Diagnostics, Keybindings, Capabilities, and About.
- Capabilities matrix in settings, comparing this build with the tools it replaces.
- Tool settings persist, including enabled tools, the maximum tool iterations, and the shell.

### Providers and sign-in

- Provider gallery with one-click Claude and ChatGPT sign-in.
- Preset API providers: Anthropic API, OpenAI, OpenRouter, DeepSeek, Kimi, Groq, Mistral, xAI,
  Together, and Gemini.
- Local providers for Ollama, LM Studio, and vLLM.
- Native Anthropic Messages adapter.
- Provider login runs in a PTY with live output.

### Review and threads

- Review comments save, list, and resolve from the diff panel.
- Reopened threads show persisted user and assistant messages.
- Diff gutters show real file line numbers, and the file tree collapses.

### Fixes

- Unwrapped Electron `MessageEvent` payloads on `parentPort`, which unblocked keyed provider
  saves and graceful shutdown.

## [0.1.0] - 2026-11-24

First release.

### Desktop

- Electron 44 application for Windows x64 with a per-user NSIS installer, desktop and Start menu
  shortcuts, and an optional `electron-updater` check gated by `TUFFCODE_ENABLE_UPDATES=1`.
- Node server runs in an Electron utility process, listens on `127.0.0.1` with an OS-assigned
  port, and publishes the port plus a bearer token to `~/.tuffcode/server.json`.
- Provider API keys are sealed with Electron `safeStorage` in the main process and never cross
  the IPC bridge to the renderer or reach logs.
- Settings for providers, models, general preferences, keybindings, and an About section with a
  redacted diagnostics export.

### Projects and threads

- Add any git repository as a project and keep multiple projects open in one window.
- Every thread runs in its own git worktree on a `tuffcode/<threadId>` branch, created from the
  project default branch and removed with the thread when requested.
- Thread status, approvals, interruption, and recovery after an interrupted turn.
- Checkpoints snapshot the worktree through `git stash create` and keep the commit reachable
  under `refs/tuffcode/<threadId>/<id>`.

### Providers

- Claude through the Claude Agent SDK.
- Codex through the Codex app-server JSONL protocol.
- ACP agents, including opencode, through the Agent Client Protocol.
- OpenAI-compatible chat completions with streaming, tool calls, and an SSE harness.
- Provider CRUD, connection tests, and model listing from the settings UI.

### Modes and council

- Plan, Work, and Council execution modes.
- Read-only, ask, accept-edits, and full-auto permission modes, mapped onto each adapter.
- Council goals: a planner decomposes the goal, parallel workers run in child threads, and a
  reviewer from another model family checks each change before a pull request opens.
- Council limits: 8 concurrent workers, 12 tasks per goal, 3 review rounds, and 2 goals per
  thread.

### Brain

- Typed memory entries: identity, preference, rule, project, memory, and working note.
- Per-turn selection with a bounded context slice and a live preview of what the next message
  will inject.
- Retrieval kill switch that still keeps the always block.

### Review and terminal

- Diff panel with changed files grouped by directory, inline review comments with resolve,
  and a checkpoint selector.
- ConPTY terminals through `node-pty`, with tabs, resize, and `pwsh.exe`, `powershell.exe`, or
  `cmd.exe` shell detection.

### Under the hood

- One WebSocket carrying a typed JSON envelope validated by Zod, with `PROTOCOL_VERSION` 1.
- SQLite storage with ordered migrations for projects, threads, turns, events, approvals,
  checkpoints, providers, settings, brain entries, and council state.
- Slash commands and skills discovered from `<project>/.tuffcode/commands` and skill files.
- esbuild server bundle, Vitest unit and integration suites, and a Playwright Electron suite.

### Known limitations

- Idle memory is about 510 MB for the 5-process tree, above the 350 MB target.
- First launch after install takes about 3.0 s; warm starts are under 400 ms.
- The Codex adapter is fixture-tested only because the codex CLI was not installed on the release
  host.
- Updates are full downloads; no blockmap is published.
- Release page notes live in this changelog because GitHub rejected the release body edit.

