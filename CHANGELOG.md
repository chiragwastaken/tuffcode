# Changelog

All notable changes to Tuffcode are documented here. The format follows Keep a Changelog, and
the project uses semantic versioning.

## [Unreleased]

## [0.3.0] - 2026-11-26

### Reliability
- Thread history is lossless: replay loads every page of events, not the first 200, and replays
  again after a reconnect. Stream deltas coalesce per contiguous segment, and the server batches
  delta writes, so tool calls, approvals, errors and turn boundaries are never evicted from a
  long thread.
- Stop settles the turn exactly once, persists a boundary even when nothing streamed, and an
  immediate Send starts a clean new turn and session instead of merging or conflicting.
- The timeline orders user and assistant rows by turn identity instead of the client clock, and
  the Thinking spinner always clears on finish, error, interrupt or a stacked send.
- A completed turn folds its reasoning, prose and tool calls into one collapsed
  `Ran N tools and thought for Xs` row above the answer; expanding restores the exact order.

### Search
- `Ctrl+F` opens an in-chat find bar with `match X of Y`, Enter and Shift+Enter navigation, and
  Esc to close. It searches every turn, including text inside collapsed steps and tool groups,
  auto-expands the containing disclosure, scrolls the virtualized timeline and highlights matches.
- The `grep` tool prefers ripgrep with Windows-safe spawning and ignore-file respect, and falls
  back to a bounded parallel Node scan. New modes list files or counts instead of full lines.
- The base prompt prefers `grep` and `glob` over shell search.

### Agents
- The Max iterations setting and every loop cap are removed. Long productive runs continue until
  the model stops, the user stops it, context compaction applies, or the same tool call repeats
  three times in a row with no new text.
- Read-only tools in one assistant step run in parallel, while writes, bash, MCP calls and
  anything needing approval stay serial in call order.
- A built-in `edit-tuffcode` skill loads automatically when you ask Tuffcode to change itself or
  its configuration, and routes provider, model, connector and setting changes through the config
  tool.
- The config tool accepts user-supplied provider keys and connector tokens, stores them in the OS
  keychain, and redacts them from emitted tool events. Claude subscription threads get the same
  `config` and `mcp` tools.
- `/reload` refreshes settings, providers, models, connectors, skills, commands and plugins and
  broadcasts the changes, so new configuration appears without a restart.

### Connectors and workspace
- MCP connectors support three auth modes: none, bearer or API key with a custom header, and
  browser OAuth 2.1 with PKCE, discovery, dynamic client registration, a loopback callback,
  automatic refresh, and keychain storage.
- The workspace splits into up to four nested tiles, horizontally or vertically, by dragging a
  tab, a pane or a sidebar chat onto an edge drop zone. Dividers resize, double-click resets, each
  tile keeps its own thread, composer, model and permission controls, and the layout persists.
- Terminal scrollback, font size and cursor style apply live to open terminals, and the update
  channel now selects stable or beta.
- Settings > Notifications has a Send test notification button that reports whether the OS
  supports and showed the notification, with a Focus Assist note.

### Known issues
- Remote OAuth is proven against a local mock authorization server; a live third-party connector
  still needs a manual check.
- Plugin hooks and agents are listed but never run.
- Codex threads do not get the todo and subagent tools.
- web_fetch does not guard against DNS rebinding between its address check and the connection.
- The installer artifact reports `0.0.0` until the release workflow stamps the tag.

## [0.2.0] - 2026-11-26

### Workspace and layout
- The left sidebar opens with New chat, Search and Plugins. Search is a dialog (`/` or
  Ctrl+Shift+F) over chat titles, projects and message text; the inline filter is gone.
- New chats name themselves from the first message with a one-line title; renames are kept, and
  older id-style titles are repaired on startup.
- The right panel is a dock that only appears when a panel is open: Activity, Terminal, Changes,
  Browser and Files toggles plus a `+` menu (terminal, browser tab, side chat, split view). It
  never overlays the chat, resizes by dragging, and the terminal starts only when asked for.
- Other chats can open as side-by-side tiles, up to four panes with draggable dividers.
- The Activity panel merges the old Context tab: environment, colored context usage, prompt
  sections, the todo list, tool calls and subagents with tool counts, tokens and live activity.
- A Files explorer with a filter (`?` for fuzzy matching) and a read-only preview, and a
  sandboxed browser tab for previews and docs.
- A card after a turn shows files changed with line counts, Review changes and Create PR.

### Plugins, skills and connectors
- A Plugins page with search, All, Connectors and Skills tabs, a Verified or Community filter and
  an Add menu (upload a .zip, .skill or SKILL.md; add a remote MCP connector by URL; create a skill
  with AI; add a marketplace). Catalogs come from anthropics/claude-plugins-official,
  knowledge-work-plugins, skills and claude-plugins-community, cached for a day.
- Installing a plugin fetches only its files with a shallow sparse git clone, refuses symlinks and
  paths that escape, and registers its skills, commands and MCP servers; toggling and removing
  apply on the next turn.
- `$name` loads a skill into the message, and agents load other skills on demand with a
  `skill` tool. Project `.claude/skills` and plugin skills are discovered too.
- MCP servers can be remote (Streamable HTTP) with a bearer token kept in the OS keychain. The
  Connectors tab searches the official MCP registry.

### Agents
- A `todo` tool keeps a phased task list per thread, shown live above the composer.
- Subagents can be waited for, messaged, stopped and asked for status; children report back and
  accept follow-ups after they finish. Subagents cannot spawn their own subagents.
- Council threads get every tool regardless of capability switches.
- Claude subscription threads get the todo, subagent, memory, skill and web fetch tools through an
  in-process MCP server.
- A `web_fetch` tool reads public pages; private, loopback and LAN addresses are refused at
  every hop.
- Reasoning effort (off to extra high, plus custom levels) reaches OpenAI-compatible, OpenRouter,
  Anthropic, Claude and Codex providers.
- Switching provider or model mid-chat replays a short digest of the conversation.

### Settings
- Providers and Models are one Models page; large model lists are searchable, and missing context
  and capability data is filled from Ollama, LM Studio and models.dev on refresh.
- Reasoning levels are pills instead of a comma-separated field.
- Your Tuffcode replaces Instructions: name, role, about you, response style, instructions up to
  2000 tokens, and memory on, pause and reset.
- Capabilities are real switches; a new Notifications section adds desktop notifications and
  keeping the computer awake while agents run.
- The composer model menu lists every enabled provider, reasoning levels and per-subagent models.

### Known issues
- Remote connectors cannot sign in with OAuth yet; use a bearer token.
- Plugin hooks and agents are listed but never run.
- Codex threads do not get the todo and subagent tools.
- The browser tab cannot show sites that forbid embedding; open them externally.
- web_fetch does not guard against DNS rebinding between its address check and the connection.
- The installer artifact reports `0.0.0` until the release workflow stamps the tag.
- Codex remains fixture-tested only; its CLI is not installed on this host.


### Sidebar and navigation
- Thread rows are 48px with a title and a meta line; project headers are 32px.
- Subagent and council child threads nest under their parent instead of listing as top-level
  conversations, and open the parent surface.

### Subagents and activity
- The dock above the composer is a compact chip row; the task and prompt are no longer shown.
- The thread header carries a centered Work/Council switch and an Activity button.
- The Activity panel lists running commands with their output tail, subagents and waiting items.

### Council
- The board wraps columns and fits up to 12 tasks, with a state legend.
- A council thread renders its board in the thread body.
- Planner, worker and reviewer run with full tool access, and approval requests are answered
  instead of hanging.

### Models and context
- Provider models store max output tokens, capabilities and reasoning effort.
- Discovery reads nested context windows, max output and modality data from model lists.
- The context limit reports its source, and the 200k fallback is labeled instead of assumed.
- The provider form has an Advanced section for context, output, capabilities and reasoning.

### MCP and self-configuration
- Local stdio MCP servers can be added, tested and removed in Settings > MCP.
- The built-in harness can list and call MCP tools, search and add memory, and change providers,
  models, MCP servers and allowlisted settings through tools.
- Claude subscription threads receive the enabled MCP servers through the Agent SDK. Codex uses
  its own MCP configuration. The memory and config tools are harness-only.

### Updates
- Packaged builds check for updates on launch, download in the background, and ask to restart
  when the update is ready. Settings > Updates now runs the same check through the desktop bridge.

### Brain and prompts
- Brain injection has a real kill switch, standing-rule capture, typed edges and preview ids.
- The base prompt, subagent prompts and council prompts were rewritten from the reference agents,
  thinking.md, APPEND_SYSTEM.md, Chief and Noticing.

## [0.1.2] - 2026-11-25

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

### Known issues

- Diff pane is narrow with the file tree expanded; collapse the tree for wide lines.
- Council board lives in the inspector; the thread shows status and the goal box.
- Codex adapter and model list are fixture-tested only because the CLI was not installed on the
  release host.
- Compaction trims harness history only, not vendor CLI sessions.
- Idle RAM is above the original target and the renderer bundle is a single chunk (issue #30).
- GitHub Actions intermittently did not fire for new pull request pushes during this round; those
  PRs were verified locally with recorded counts.

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

