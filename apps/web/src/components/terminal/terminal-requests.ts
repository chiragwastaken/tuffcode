import { directoryOf } from '../diff/diff-model';

/**
 * One-slot hand-off from the diff panel to the terminal panel: "open a terminal
 * at this file's directory". A slot keeps the request alive when the terminal
 * tab mounts after the menu action, without a global store.
 */

let pending: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestTerminalAt(path: string): void {
  pending = path;
  emit();
}

/** Consumes the pending path, if any. */
export function takeTerminalRequest(): string | null {
  const path = pending;
  pending = null;
  return path;
}

export function subscribeTerminalRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A `cd` for the thread's shell, quoted so spaces survive. */
export function terminalCdCommand(path: string): string {
  const directory = directoryOf(path);
  const target = directory === '' ? '.' : directory;
  return `cd "${target.replaceAll('"', '\\"')}"\r`;
}
