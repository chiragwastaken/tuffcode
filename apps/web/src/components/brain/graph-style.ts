import type { BrainKind } from '@tuffcode/contracts';

/**
 * One hue per brain kind. The values sit between the dark and light themes on
 * purpose: the same node color stays legible on both backgrounds, so the graph
 * does not need a second palette for light mode.
 */
export const BRAIN_KIND_COLOR: Record<BrainKind, string> = {
  identity: '#a78bfa',
  preference: '#60a5fa',
  rule: '#fbbf24',
  project: '#34d399',
  memory: '#f472b6',
  'working-note': '#94a3b8',
};
