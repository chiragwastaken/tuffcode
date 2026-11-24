# Installing Tuffcode on Windows

## Build the installer

Requirements: Node 24, pnpm 11.3.0, and a Windows x64 host.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tuffcode/desktop run build:win
```

The script builds the server bundle, the Electron main/preload/renderer output, and then
packages the NSIS installer. Artifacts land in `apps/desktop/dist/`:

- `Tuffcode-Setup-<version>.exe`
- `latest.yml`
- `Tuffcode-Setup-<version>.exe.blockmap`

`build:win:publish` runs the same build with `--publish always`, which uploads the three
files to the GitHub release for the current tag.

## Install

Run `Tuffcode-Setup-<version>.exe`. The installer is a per-user NSIS installer (`perMachine:
false`), so it does not require elevation, and it lets you choose the installation directory.

Silent install into a custom directory (the `/D=` argument must come last and must not be
quoted):

```bat
Tuffcode-Setup-0.0.0.exe /S /D=C:\Temp\Tuffcode
```

Uninstall silently with the generated uninstaller:

```bat
"%LOCALAPPDATA%\Programs\Tuffcode\Uninstall Tuffcode.exe" /S
```

## Code signing

Signing is environment-driven and optional. When `CSC_LINK` (a certificate path, URL, or
base64 blob) and `CSC_KEY_PASSWORD` are set, electron-builder signs the executable and the
installer. When they are absent the build completes unsigned. The release workflow reads both
from repository secrets, so an unsigned build only happens when the secrets are unset.

## Runtime layout

The packaged app keeps its mutable state outside the install directory:

- `~/.tuffcode/` holds `server.json`, the auth token, brain data, and secrets.
- `%LOCALAPPDATA%\Tuffcode\` holds logs, `tuffcode.db`, and worktrees.

The server bundle and the renderer build are shipped as extra resources under
`resources/server` and `resources/web`. `node-pty` is unpacked next to the server bundle so its
native prebuilds load outside the asar archive.

## Troubleshooting

### The server fails to start

Tuffcode shows an error dialog and quits when the bundled server cannot start. The dialog names
the failure: `Tuffcode server not found`, `Tuffcode could not start`, or `Tuffcode could not read
the server connection`.

- `server not found` means the bundle is missing. In a source checkout run `pnpm build:server`;
  for a packaged build, confirm `resources/server/server.js` exists next to the executable.
- `could not start` usually means the process exited early or missed the 10 second ready
  deadline. Read `%LOCALAPPDATA%\Tuffcode\logs\server.log` and `main.log` for the exit code and
  stderr.
- A locked `tuffcode.db`, a full disk, or another instance using the same `userData` directory
  can also stop startup. Close every Tuffcode window and retry.
- `could not read the server connection` means `~/.tuffcode/server.json` was unreadable or held a
  stale port. Close Tuffcode, delete that file, and start again.

`pnpm smoke:server` boots the bundle against temporary directories and reports the same
handshake failure without the UI.

### Windows SmartScreen

Unsigned builds trigger "Windows protected your PC" on first launch. Choose More info, then Run
anyway, or sign the build with `CSC_LINK` and `CSC_KEY_PASSWORD`. The warning means the
certificate is missing, not that the app is known to be unsafe.

### Logs and data

- `%LOCALAPPDATA%\Tuffcode\logs\`: `main.log`, `server.log`, and `adapter.log`, rotated at 2 MB
  with five files per channel. Secrets are redacted before writing.
- `%LOCALAPPDATA%\Tuffcode\tuffcode.db`: SQLite state for projects, threads, messages, events,
  brain entries, checkpoints, and providers.
- `%LOCALAPPDATA%\Tuffcode\worktrees\`: one worktree per thread under the configured worktree
  root, which defaults to this directory.
- `~/.tuffcode\`: `server.json`, `token`, `secrets.bin`, and `brain\`.
- Settings > About > Export diagnostics writes a redacted JSON snapshot with versions, counts,
  paths, settings, and warnings to the logs directory.

Set `TUFFCODE_HOME` to move the home directory. `TUFFCODE_USER_DATA` moves the Electron profile
and its single-instance lock; `LOCALAPPDATA` moves the database, logs, and worktrees.
