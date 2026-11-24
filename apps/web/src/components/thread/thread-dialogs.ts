import type { Thread } from '@tuffcode/contracts';
import { useSyncExternalStore } from 'react';

export type ThreadDialogRequest =
  | { kind: 'rename'; thread: Thread }
  | { kind: 'delete'; thread: Thread };

let current: ThreadDialogRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opened by the thread row menu, the palette, or any other action surface. */
export function requestThreadRename(thread: Thread): void {
  current = { kind: 'rename', thread };
  emit();
}

export function requestThreadDelete(thread: Thread): void {
  current = { kind: 'delete', thread };
  emit();
}

export function closeThreadDialog(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function useThreadDialogRequest(): ThreadDialogRequest | null {
  return useSyncExternalStore(subscribe, () => current);
}
