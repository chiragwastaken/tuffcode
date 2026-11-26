# Tuffcode feature list

Status as of v0.3.0. `Shipped` means in the released build; `Next` is the round in progress;
`Later` is deliberately deferred with the reason. This file is the public product list; the
internal rationale lives in `decisions.md` (local only).

## Shipped

### Workspace
- Projects, threads, and isolated git worktrees per thread.
- New chats titled from the first message, renames kept, legacy titles repaired.
- Sidebar with project groups, nested subagent rows, search dialog, plugins entry.
- Split tiles up to four, nested horizontally and vertically, edge drop zones, persisted layout.
- Right dock with Activity, Terminal, Changes, Browser, Files and a `+` menu.
- File explorer with fuzzy filter and read-only preview; sandboxed browser pane.

### Agents
- Claude subscription, Codex, Anthropic API, OpenAI-compatible, local models, and ACP providers.
- Model discovery with context window, max output, vision, tools and reasoning metadata.
- Work, Plan, and Council modes; read-only, ask, accept-edits and full-auto permissions.
- Typed subagents: explorer, reviewer, notetaker, worker, planner, with per-type models.
- Council planner, parallel workers, cross-model review, node board and report.
- Skills (`$name` and on-demand), slash commands, MCP tools, memory tools, todo list.
- Self-configuration through the `config` tool, a built-in edit-tuffcode skill, and `/reload`.
- Lossless history: every replay page, reconnect replay, coalesced deltas, no tool loss.
- Stop with a single settle, a persisted boundary, and an immediate clean Send.
- Folded pre-answer steps, Ctrl+F find across collapsed content, streaming progress.

### Review and git
- Diff viewer with real line numbers, inline comments, checkpoints, and revert.
- Commit, push, and draft PR from the thread; turn summary with changed files and Create PR.
- Permission approvals as cards with allow and deny.

### Context and memory
- Prompt assembly with base, profile, custom instructions, skills, brain, turn context.
- Brain graph with typed entries, standing rules, search, links, and injection reasons.
- Context meter, per-model limits with a labeled source, auto-compaction, `/compact`.

### Terminal and desktop
- ConPTY terminals with tabs, shell selection, live scrollback, font and cursor settings.
- Native notifications with a test trigger, keep-awake, and click-to-thread routing.
- Auto-update from GitHub Releases, stable and beta channels.
- Windows-first packaging: per-user NSIS installer, long paths, CRLF handling.

### Connectors and plugins
- Plugin hub with official and community marketplaces, upload, and AI-created skills.
- MCP connectors: stdio and HTTP, none, bearer with a custom header, and OAuth 2.1 PKCE.
- Secrets in the OS keychain, never in SQLite, logs, or tool events.

### Shipped in v0.3.1
- Read-only and plan mode run a hardened allowlist of read-only shell commands; explorer
  subagents can investigate with `git log`, `ls` and similar, and `read` lists a directory.
- A command that produces no output for 30 seconds is stopped and marked as not run.
- OpenAI-compatible providers that require `max_completion_tokens` work, and the Vision toggle is
  honored when discovery reported no hints.
- Council uses the configured planner, worker and reviewer models and shows provider error text.
- New chat defaults to the project folder, with an explicit worktree option and deletion guards
  that can never remove the checkout.
- A Needs you inbox lists approvals, stalled runs, failures and ready-to-review threads across
  projects, with inline Allow and Deny.
- The prompt loads AGENTS.md, CLAUDE.md and .tuffcode/rules/*.md under a token budget.

## Next

These are the highest-value gaps still open, ranked by user value and fit with the local-first
design.

1. Per-hunk accept and reject with a turn-scoped review queue.
2. Fork a thread from a message and rewind code, conversation, or both.
3. Usage and cost per thread with a soft cap and a cache-cold warning.
4. Worktree bootstrap: scrub GIT_DIR from child environments and link dependencies per project.
5. Lifecycle hooks (pre and post tool, session start, stop) with a manifest and Settings editor.
6. Mid-turn steering and a prompt queue while a turn runs.

## Later

- Lifecycle hooks (pre and post tool, session start, stop) with a manifest and Settings editor.
- Mid-turn steering and a prompt queue while a turn runs.
- Pre-commit and PR review gate with findings, check polling, and auto-fix.
- Repo map (tree-sitter, token-budgeted) for large repositories.
- Scheduled tasks with a review queue, while the app is running.
- Agent-controlled browser over CDP, behind a capability switch.
- Global agent dashboard beyond the needs-you inbox, with dispatch and archive.
- Detached background runs that survive closing the window.
- LSP code intelligence tool and post-edit diagnostics.
- Cross-thread messaging and model handoff.
- WSL and SSH session targets.
- Semantic codebase index.

## Not planned

- Voice chat, personality styles, prompt enhancement, and suggested replies: low coding leverage.
- Cloud agents, hosted VMs, billing, and team accounts: breaks the local-first, no-backend design.
- Build-and-deploy live apps: different product; the agent can call the user's deploy CLI.
- Session share links and artifact publishing: privacy cost, little solo value.
- Kanban with dependency chains: duplicates threads and council; the useful part is auto-commit.
