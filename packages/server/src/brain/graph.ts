import type { BrainEntry, BrainKind } from '@tuffcode/contracts';
import type { BrainListOptions, BrainRepo } from '../db/repos/index.js';

/**
 * Brain graph construction, spec section 15.8.
 *
 * Nodes are active entries scoped to the project plus the global brain, capped at
 * 300 by importance and recency. Project and working-note entries are reserved so
 * the graph always carries its anchors even when memories outrank them. Edges come
 * from `brain_edges` and are kept only when both endpoints made the node cut, which
 * keeps the renderer's force layout from dangling.
 */
export const GRAPH_MAX_NODES = 300;
const LABEL_LENGTH = 60;

export interface BrainGraphInput {
  projectId?: string;
  limit?: number;
}

export interface BrainGraphNode {
  id: string;
  kind: BrainKind;
  label: string;
  importance: number;
  degree: number;
}

export interface BrainGraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
}

function byImportanceAndRecency(a: BrainEntry, b: BrainEntry): number {
  return (
    b.importance - a.importance ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}

export function buildBrainGraph(repo: BrainRepo, input: BrainGraphInput = {}): BrainGraph {
  const cap = Math.min(input.limit ?? GRAPH_MAX_NODES, GRAPH_MAX_NODES);
  const scope: BrainListOptions =
    input.projectId === undefined
      ? { limit: GRAPH_MAX_NODES }
      : { limit: GRAPH_MAX_NODES, projectId: input.projectId, includeGlobal: true };

  // Anchors get their own query so a project entry outside the top 300 still lands.
  const anchors = [
    ...repo.list({ ...scope, kind: 'project' }),
    ...repo.list({ ...scope, kind: 'working-note' }),
  ];
  const byId = new Map<string, BrainEntry>();
  for (const entry of [...anchors, ...repo.list(scope)]) byId.set(entry.id, entry);

  const ranked = [...byId.values()].toSorted(byImportanceAndRecency);
  const anchorIds = new Set(anchors.map((entry) => entry.id));
  const chosen = [
    ...ranked.filter((entry) => anchorIds.has(entry.id)),
    ...ranked.filter((entry) => !anchorIds.has(entry.id)),
  ]
    .slice(0, cap)
    .toSorted(byImportanceAndRecency);

  const nodeIds = new Set(chosen.map((entry) => entry.id));
  const edges = repo.listEdges().filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  return {
    nodes: chosen.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.text.slice(0, LABEL_LENGTH),
      importance: entry.importance,
      degree: degree.get(entry.id) ?? 0,
    })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, relation: edge.relation })),
  };
}
