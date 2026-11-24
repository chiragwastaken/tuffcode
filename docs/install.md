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
