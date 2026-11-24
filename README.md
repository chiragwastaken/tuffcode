# Tuffcode

Local-first desktop app for agentic coding on Windows. One window, many agents, your machine.

## Requirements

- Windows 10 1809 or newer
- Node.js 24 or newer
- pnpm 11 (`corepack enable` then `pnpm install`)

## Development

```powershell
pnpm install
pnpm dev          # Electron app with hot reload
pnpm check        # typecheck, lint, emdash scan
pnpm test         # unit and integration tests
pnpm build        # production bundles
pnpm build:win    # NSIS installer
```

The renderer never talks to Node directly: it sends JSON-RPC over a loopback WebSocket to a
server running in an Electron utility process. See [AGENTS.md](./AGENTS.md) for the
architecture, package map, and contribution rules. MIT licensed.
