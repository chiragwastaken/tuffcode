# AGENTS.md

Tuffcode is an open-source, Windows-first Electron desktop app for agentic coding.

## Architecture

- `apps/desktop` owns Electron main and preload. It starts the server in `utilityProcess.fork()`,
  holds secrets via `safeStorage`, and exposes a narrow IPC bridge.
- `packages/server` runs all Node-side logic: WebSocket JSON-RPC, SQLite, PTY, worktrees,
  adapters. It listens on `127.0.0.1` with an OS-assigned port and writes the port plus a
  bearer token to `~/.tuffcode/server.json`.
- `apps/web` is the React renderer; it talks to the server only over WebSocket. No Node builtins.

`packages/contracts` is the only package both sides import (Zod schemas, wire types).
`packages/adapters` normalizes provider SDKs behind one event contract. `packages/ui` is the
renderer-only design system. `packages/prompt` holds the base prompt and tool schemas.
Renderer imports `contracts` and `ui`; server imports `contracts`, `adapters`, `prompt`.

## Rules

- Zero em dashes and en dashes anywhere. `pnpm check:emdash` enforces this, file names too.
- Read a file before editing it. Read whole sections, not fragments.
- No stubs or silent fake fallbacks in shipped paths. Scaffolding is fine, pretend is not.
- No telemetry or unrequested network calls. Secrets never reach logs or the renderer.
- Never disable auth, validation, or permission checks to make a test pass.
- Prefer updating existing files over adding new ones. One convention per problem.
- Every SQL query is parameterized. No string concatenation into SQL.

## Commands

```powershell
pnpm install    # install workspace dependencies
pnpm dev        # Electron app, hot reload
pnpm check      # typecheck + lint + emdash scan
pnpm test       # Vitest, unit and integration
pnpm test:e2e   # Playwright, launches the built app
pnpm fmt        # format with Oxfmt
pnpm build      # bundle main, preload, renderer
pnpm build:win  # NSIS installer
```

Run the narrowest check that covers your change, then `pnpm check` before a PR.

## Windows specifics

- Terminals use ConPTY via `node-pty`; no winpty. Shell: `pwsh.exe`, `powershell.exe`, `cmd.exe`.
- Kill process trees with `taskkill /T /F`; a bare `kill` leaks children.
- Paths over 248 characters need the `\\?\` prefix; use the `winPath` helper, not string joins.
- Preserve existing line endings. New files are LF unless the target tree demands CRLF.
- `os.homedir()` reads `USERPROFILE` on Windows, not `HOME`. Tests must set both.

## Pull requests

- Branch from `main` as `feat/<slice>` or `fix/<slice>`.
- One logical change per PR. Stage only the files you changed, with explicit paths.
- A reviewer other than the author reads the diff before merge. Squash merge.
- Never force push. Never commit local material: `Chief/`, `Noticing/`, `references/`,
  `others/`, `decisions.md`, `PRD.md`, `spec.md`, `plan.md`, `.tuffcode-ops/`, `.env*`.
- CI must be green on `windows-latest`: `pnpm check` and `pnpm test`.
