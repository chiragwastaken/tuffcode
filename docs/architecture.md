# Architecture

Tuffcode is one Electron window over a local server process. The renderer never touches the
filesystem, git, PTY, or provider CLIs; everything goes through one authenticated WebSocket.

## Processes

```
Electron main
  BrowserWindow (renderer, contextIsolation, sandbox, no Node)
  utilityProcess.fork(server.js)     Node 24 ABI
    node:http on 127.0.0.1:random    /health, SPA assets in production
    WebSocket /ws                     one connection, bearer token
    node:sqlite                      %LOCALAPPDATA%/Tuffcode/tuffcode.db
    node-pty                         one session per terminal tab
    adapter subprocesses             claude, codex app-server, ACP agents
    git and gh                       worktrees, diffs, draft PRs
  safeStorage                        provider keys, never sent to the renderer
```

Startup: main acquires the single-instance lock, spawns the server, waits for
`{ type: 'ready', port }`, then loads the renderer with the port. The server writes
`server.json` with the port and a bearer token to `~/.tuffcode`. Shutdown sends
`{ type: 'shutdown' }`; the server disposes terminals, subagents, sessions, and the database.

## Packages

| Package | Responsibility |
| --- | --- |
| `apps/desktop` | Electron main and preload, window chrome, secrets, updater, server lifecycle |
| `apps/web` | React renderer: router, store, RPC client, sidebar, timeline, composer, inspector |
| `packages/contracts` | Zod schemas for entities, RPC methods, adapter and server events, settings |
| `packages/server` | SQLite and migrations, WS transport, projects, threads, runner, subagents, brain, council, providers, model catalog, git, PTY, commands, skills |
| `packages/adapters` | Claude Agent SDK, Codex app-server, ACP, OpenCode, OpenAI-compatible, Anthropic Messages |
| `packages/prompt` | Base system prompt, tool schemas, council and subagent prompts, turn context |
| `packages/ui` | Design tokens and primitives, markdown, diff, terminal |
| `packages/shared` | Paths, Windows path helpers, logger with rotation and redaction, ids, EOL |

Dependency rule: the renderer imports `contracts` and `ui` only. The server imports
`contracts`, `adapters`, `prompt`, and `shared`. Nothing imports `apps/web` from the server.

## Wire protocol

Requests: `{ id, method, params }`. Responses: `{ id, ok: true, result }` or
`{ id, ok: false, error: { code, message } }`. Server pushes:
`{ kind: 'event', type, threadId?, seq?, payload }`. Every frame is validated with Zod on both
sides. `PROTOCOL_VERSION` is 1.

Thread events are durable: each event is written to `events` with a per-thread `seq` before it is
broadcast, so a reconnect replays from `sinceSeq`. The renderer keeps at most 5000 events per
thread in memory and loads older pages on demand.

## Threads and worktrees

A thread is the unit of work: project, provider and model, execution mode, permission mode, a git
worktree on branch `tuffcode/<threadId>`, checkpoints, diff, and PR. Creating a thread provisions
the worktree under `%LOCALAPPDATA%/Tuffcode/worktrees/<projectId>/<threadId>`. Checkpoints use
`git stash create` plus a hidden ref; revert is a hard reset behind an explicit RPC.

## Providers and models

Every provider is an adapter behind one session interface and one event union. Provider kinds:
`claude` (subscription CLI), `codex` (subscription CLI), `anthropic` (API key, native Messages
API), `openai-compatible` (API key or local endpoint), `acp`, and `opencode`.

Models are discovered: Claude through the Agent SDK, Codex through app-server, Anthropic through
`/v1/models`, OpenAI-compatible through `/models`, ACP through session config options. Results are
cached per provider; manual entry remains available when a gateway returns nothing.

Secrets live in the desktop process, sealed with `safeStorage`. The server asks for a secret over
the utilityProcess message port with a request id; replies never contain the value for writes.
The parentPort delivers `MessageEvent` objects, so the server unwraps `.data`.

## Prompt assembly

Per turn: static base prompt (600 to 900 tokens), custom instructions (max 300), brain always
block (400), retrieved memory (400, at most 8 entries), turn context (date, mode, cwd, project),
then the user message. `prompt.preview` returns the same sections with token counts. Raw planning
documents are never injected.

## Brain

SQLite tables hold identity, preference, rule, project, memory, working note, and edges. FTS5
provides search with sync triggers. The selector scores by BM25, importance, recency, and use
count, dedupes, and caps the slice. The renderer draws the graph from `brain.graph`; the agent can
call `memory.search` with the same budget rules.

## Subagents

Types: explorer (read-only mapping), reviewer (nine-point rubric), notetaker (writes memory),
worker (implements in its own worktree), planner (decomposes goals). Each type has a model and a
fallback in settings. Children stream events to the parent thread with a child id, run up to the
configured concurrency, and can be cancelled individually. Child threads nest under the parent in
the sidebar and open in a pane, never as their own conversation.

## MCP and extra tools

Local stdio MCP servers live in `mcp_servers` and are managed from Settings > MCP. A small JSON-RPC
client speaks initialize, tools/list and tools/call with a 10s timeout, a 60s tool cache, and a
64 KiB result cap. The harness offers one `mcp` tool with list and call actions, plus `memory`
(search, add) and `config` (provider.add, provider.model.add, mcp.add, settings.set with an
allowlist). They are outside `enabledTools`, classified by permission mode, and reach the server
through one extra-tool port injected into the adapter dependencies. Tool input is redacted before
it is persisted or broadcast.

## Council

Council is a thread execution mode. The planner returns a JSON task list, the server provisions a
child thread per task, workers implement, a reviewer from a different model family gates each
task, and the result is reported in the parent thread. Caps: 8 concurrent workers, 12 tasks, 3
review rounds.

## Security

Loopback-only server, bearer token compared with `timingSafeEqual`, Zod on every frame, file
tools confined to the worktree with realpath checks, `bash` with a timeout and process-tree kill,
no telemetry, and a logger that redacts five secret patterns before writing. The config tool never
accepts a credential, MCP env keys that look like secrets are rejected, and tool input is redacted
before persistence and broadcast.

## Testing

Vitest covers contracts, shared, server (real SQLite and real git repositories), adapters
(fixtures, no vendor CLIs), prompt budgets, brain selection, and renderer logic. Playwright
launches the built Electron app against a mock OpenAI-compatible server for boot, streaming,
approvals, diff, restart, settings, provider gallery, and persisted user messages.
