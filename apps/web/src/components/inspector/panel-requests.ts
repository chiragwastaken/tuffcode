import type { PromptPreview } from '@tuffcode/contracts';
import type { InspectorTab } from './inspector-tabs';

/**
 * One-slot hand-off from the composer to the dock: "/context" opens Activity with its
 * prompt sections showing the preview the server already computed, and "/model" style commands can
 * raise a tab without either component importing the other.
 */

let pendingTab: InspectorTab | null = null;
let pendingPreview: PromptPreview | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestInspectorTab(tab: InspectorTab, preview?: PromptPreview): void {
  pendingTab = tab;
  if (preview !== undefined) pendingPreview = preview;
  emit();
}

/** The tab the inspector should show, consumed once by the panel. */
export function takeInspectorTab(): InspectorTab | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}

/** True while a preview waits for the context section, without consuming it. */
export function hasContextPreview(): boolean {
  return pendingPreview !== null;
}

/** The prompt preview the context panel should render, consumed once. */
export function takeContextPreview(): PromptPreview | null {
  const preview = pendingPreview;
  pendingPreview = null;
  return preview;
}

export function subscribePanelRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
