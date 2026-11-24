import type { BrainKind } from '@tuffcode/contracts';
import type { BrainGraphNode } from './graph-layout';

/**
 * Search and filter plumbing for the brain list. The debounce lives here as a
 * plain function so the panel can share one runner and the behavior is testable
 * without a DOM.
 */
export interface DebouncedRunner<T> {
  /** Replace any pending call with this value. */
  schedule(value: T): void;
  /** Run the pending call now, if there is one. */
  flush(): void;
  /** Drop the pending call. */
  cancel(): void;
}

export function createDebouncedRunner<T>(
  delayMs: number,
  run: (value: T) => void,
): DebouncedRunner<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;

  function fire(): void {
    timer = undefined;
    const next = pending;
    pending = null;
    if (next !== null) run(next.value);
  }

  return {
    schedule(value) {
      pending = { value };
      clearTimeout(timer);
      timer = setTimeout(fire, Math.max(0, delayMs));
    },
    flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        fire();
      }
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

export function matchesKindFilter(kind: BrainKind, filter: BrainKind | null): boolean {
  return filter === null || kind === filter;
}

export function filterByKind<T extends { kind: BrainKind }>(
  items: readonly T[],
  filter: BrainKind | null,
): T[] {
  if (filter === null) return [...items];
  return items.filter((item) => item.kind === filter);
}

/** Importance first, then connectivity, then id: a stable, readable list order. */
export function sortGraphNodes(nodes: readonly BrainGraphNode[]): BrainGraphNode[] {
  return [...nodes].toSorted(
    (a, b) => b.importance - a.importance || b.degree - a.degree || a.id.localeCompare(b.id),
  );
}

export function formatSearchScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : '0.00';
}
