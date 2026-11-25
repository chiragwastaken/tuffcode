/**
 * One-slot hand-off from the toolbar and menus to the pane workspace: open another
 * chat beside this one, or split a tool surface into the row. The workspace consumes
 * the request; neither side imports the other.
 */
export type PaneRequest =
  | { kind: 'side-chat'; threadId: string }
  | { kind: 'split'; surface: 'diff' | 'files' | 'terminal' | 'browser' | 'brain' };

let pending: PaneRequest | null = null;
const listeners = new Set<() => void>();

export function requestPane(request: PaneRequest): void {
  pending = request;
  for (const listener of listeners) listener();
}

export function takePaneRequest(): PaneRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribePaneRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
