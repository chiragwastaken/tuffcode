import type { Attachment } from '@tuffcode/contracts';

type PathBridge = { getPathForFile: (file: File) => string };

function isPathBridge(value: unknown): value is PathBridge {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getPathForFile' in value &&
    typeof value.getPathForFile === 'function'
  );
}

function bridgeOf(): unknown {
  const scope: unknown = globalThis;
  return typeof scope === 'object' && scope !== null && 'tuffcode' in scope ? scope.tuffcode : null;
}

function legacyPath(file: File): string | null {
  if (!('path' in file)) return null;
  const value: unknown = file.path;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function filePath(file: File): string | null {
  const bridge = bridgeOf();
  if (isPathBridge(bridge)) {
    const fromBridge = bridge.getPathForFile(file);
    if (fromBridge.length > 0) return fromBridge;
  }
  return legacyPath(file);
}

/** True when a picked File can become a filesystem path in this runtime. */
export function hasFilePathBridge(): boolean {
  return isPathBridge(bridgeOf());
}

/**
 * The wire attachment needs a real filesystem path. Electron 32 removed
 * `File.path`, so the desktop preload must expose `getPathForFile`; without it
 * the composer falls back to the folder picker.
 */
export function attachmentFromFile(file: File): Attachment | null {
  const path = filePath(file);
  if (!path) return null;
  const attachment: Attachment = { name: file.name, path };
  if (file.type.length > 0) attachment.mimeType = file.type;
  return attachment;
}

export function attachmentFromFolder(path: string): Attachment {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  const name = segments.at(-1) ?? path;
  return { name, path };
}
