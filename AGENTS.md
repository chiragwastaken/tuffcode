# AGENTS.md

Tuffcode is an open-source, Windows-first Electron desktop app for agentic coding.

## Architecture

- `apps/desktop` owns Electron main and preload. It starts the server in `utilityProcess.fork()`,
  holds secrets via `safeStorage`, and exposes a narrow IPC bridge.
- `packages/server` runs all Node-side logic: WebSocket server, SQLite, PTY, worktrees, runner,
  subagents, brain, council, model catalog, and adapters. It listens on `127.0.0.1` with an
  OS-assigned port and writes the port plus a bearer token to `~/.tuffcode/server.json`.
- `apps/web` is the React renderer; it talks to the server only over one WebSocket, with no Node builtins.

The wire is a typed JSON envelope, not JSON-RPC. `PROTOCOL_VERSION` is 1: requests are
`{ id, method, params }`, responses are `{ id, ok, result }` or `{ id, ok: false, error }`,
and server pushes are `{ kind: 'event', type, ... }`. Zod validates every frame.

`packages/contracts` is the only package both sides import (Zod schemas, wire types).
`packages/adapters` normalizes provider SDKs behind one event contract. `packages/ui` is the
renderer-only design system, `packages/prompt` the base prompt and tool schemas, and
`packages/shared` the Node utilities both sides use: paths, ids, logger, `winPath`, and line
endings. Renderer imports `contracts` and `ui`; server imports the rest.

## Rules

- Zero em dashes and en dashes anywhere. `pnpm check:emdash` enforces this, file names too.
- Read a file before editing it. Read whole sections, not fragments.
- No stubs or silent fake fallbacks in shipped paths. Scaffolding is fine, pretend is not.
- No telemetry or unrequested network calls. Secrets never reach logs or the renderer.
- Never disable auth, validation, or permission checks to make a test pass.
- Prefer updating existing files over adding new ones. One convention per problem.
- Every SQL query is parameterized. No string concatenation into SQL.
- Every change ships with an audit at `.tuffcode-ops/audits/<batch>-<agent>.md`: files touched,
  exact commands and output tails, deviations, and what was not verified. No audit, no merge.
- Only the maintainer edits markdown documents (`README`, `AGENTS`, `CHANGELOG`, `docs/`).
  Contributors report doc changes in the PR body instead of editing them.

## Commands

```powershell
pnpm install      # install workspace dependencies
pnpm dev          # Electron app, hot reload
pnpm check        # typecheck + lint + emdash scan
pnpm test         # Vitest, unit and integration
pnpm test:e2e     # Playwright, builds then launches the app
pnpm fmt          # format with Oxfmt
pnpm build:server # bundle the Node server to packages/server/dist/server.js
pnpm build        # bundle main, preload, renderer
pnpm build:win    # NSIS installer
```

Run the narrowest check that covers your change, then `pnpm check` before a PR.

## Windows specifics

- Terminals use ConPTY via `node-pty`; no winpty. Shells: `pwsh.exe`, `powershell.exe`, `cmd.exe`.
- Kill process trees with `taskkill /T /F`; a bare `kill` leaks children.
- Paths over 248 characters need the `\\?\` prefix; use the `winPath` helper, not string joins.
- Preserve existing line endings. New files are LF unless the target tree demands CRLF.
- `os.homedir()` reads `USERPROFILE` on Windows, not `HOME`. Tests must set both.

## Issues, pull requests, releases

- Issues must be workable without a conversation: Summary, Context, Scope, Acceptance criteria,
  Verification. Use `.github/ISSUE_TEMPLATE/`. Title prefix `bug:`, `feat:`, `perf:`, `chore:`;
  one `area:*` and one `priority:*` label.
- PRs link the issue with `Closes #N`, fill the PR template (summary, changes, evidence with
  command tails, risk, audit path), and keep one logical change. Reviewer separate from author.
  Squash merge. Never force push `main`.
- CI green: `pnpm check` and `pnpm test`. If Actions does not fire, record local `pnpm check`,
  `pnpm test` and `pnpm test:e2e` tails in the PR and treat the post-merge main run as the check.
- Releases: dated CHANGELOG section with Known issues, tag from green main, workflow uploads exe,
  `latest.yml` and blockmap, then verify from GitHub (install, `/health` version, uninstall).
- Never commit local material: `Chief/`, `Noticing/`, `references/`, `others/`, `decisions.md`,
  `PRD.md`, `spec.md`, `spec-ui.md`, `plan.md`, `WORKFLOW.md`, `WHAT-HAPPENED-TILL-NOW.md`,
  `.tuffcode-ops/`, `.env*`.

Full detail: [docs/contributing.md](./docs/contributing.md).
