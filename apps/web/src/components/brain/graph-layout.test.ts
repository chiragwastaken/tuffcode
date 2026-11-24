import { describe, expect, it } from 'vitest';
import {
  MAX_GRAPH_NODES,
  MAX_NODE_RADIUS,
  MIN_NODE_RADIUS,
  capGraphNodes,
  highlightedNodeIds,
  labelPlacement,
  layoutBrainGraph,
  nextNodeInDirection,
  nodeRadius,
  type BrainGraphEdge,
  type BrainGraphNode,
  type LayoutNode,
} from './graph-layout';

function makeNode(id: string, overrides: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return {
    id,
    kind: 'memory',
    label: `Entry ${id}`,
    importance: 0.5,
    degree: 0,
    ...overrides,
  };
}

const NODES: BrainGraphNode[] = [
  makeNode('a', { importance: 0.9, degree: 2 }),
  makeNode('b', { importance: 0.4, degree: 1 }),
  makeNode('c', { importance: 0.2, degree: 1 }),
  makeNode('d', { importance: 0.7, degree: 0, kind: 'rule' }),
  makeNode('e', { importance: 0.1, degree: 0, kind: 'identity' }),
];

const EDGES: BrainGraphEdge[] = [
  { from: 'a', to: 'b', relation: 'about' },
  { from: 'a', to: 'c', relation: 'mentions' },
  { from: 'd', to: 'a', relation: 'related' },
];

describe('brain graph layout', () => {
  it('lays the same graph out identically on every call', () => {
    const first = layoutBrainGraph(NODES, EDGES, { width: 480, height: 320 });
    const second = layoutBrainGraph(NODES, EDGES, { width: 480, height: 320 });

    expect(first.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      second.nodes.map((node) => [node.id, node.x, node.y]),
    );
  });

  it('spreads unconnected nodes instead of collapsing them', () => {
    const loose = Array.from({ length: 12 }, (_, index) => makeNode(`loose-${String(index)}`));
    const layout = layoutBrainGraph(loose, [], { width: 400, height: 300 });

    const rounded = new Set(
      layout.nodes.map((node) => `${node.x.toFixed(1)}:${node.y.toFixed(1)}`),
    );
    expect(rounded.size).toBe(loose.length);

    const meanRadius =
      layout.nodes.reduce((total, node) => total + Math.hypot(node.x - 200, node.y - 150), 0) /
      layout.nodes.length;
    expect(meanRadius).toBeGreaterThan(30);
  });

  it('keeps positions finite and inside the viewport', () => {
    const layout = layoutBrainGraph(NODES, EDGES, { width: 320, height: 240 });
    expect(layout.nodes).toHaveLength(NODES.length);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(320);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(240);
    }
  });

  it('returns an empty layout when the viewport has no size', () => {
    expect(layoutBrainGraph(NODES, EDGES, { width: 0, height: 0 }).nodes).toEqual([]);
  });

  it('maps importance onto the 6 to 14 pixel radius range', () => {
    expect(nodeRadius(0)).toBe(MIN_NODE_RADIUS);
    expect(nodeRadius(0.5)).toBe((MIN_NODE_RADIUS + MAX_NODE_RADIUS) / 2);
    expect(nodeRadius(1)).toBe(MAX_NODE_RADIUS);
    expect(nodeRadius(4)).toBe(MAX_NODE_RADIUS);
    expect(nodeRadius(-1)).toBe(MIN_NODE_RADIUS);
    expect(nodeRadius(Number.NaN)).toBe(MIN_NODE_RADIUS);

    const layout = layoutBrainGraph(
      [makeNode('low', { importance: 0 }), makeNode('high', { importance: 1 })],
      [],
      { width: 200, height: 200, iterations: 4 },
    );
    expect(layout.nodes.map((node) => node.radius)).toEqual([MIN_NODE_RADIUS, MAX_NODE_RADIUS]);
  });

  it('highlights the selected node and only its direct neighbors', () => {
    expect([...highlightedNodeIds('a', EDGES)].toSorted()).toEqual(['a', 'b', 'c', 'd']);
    expect([...highlightedNodeIds('b', EDGES)].toSorted()).toEqual(['a', 'b']);
    expect([...highlightedNodeIds('e', EDGES)]).toEqual(['e']);
    expect(highlightedNodeIds(null, EDGES).size).toBe(0);
  });

  it('caps the graph at 300 nodes by importance, then degree, then id', () => {
    const many = Array.from({ length: MAX_GRAPH_NODES + 20 }, (_, index) =>
      makeNode(`node-${String(index).padStart(3, '0')}`, {
        importance: index / (MAX_GRAPH_NODES + 20),
        degree: index % 5,
      }),
    );

    const capped = capGraphNodes(many);
    expect(capped).toHaveLength(MAX_GRAPH_NODES);
    // The twenty least important nodes are the ones dropped.
    expect(capped.some((node) => node.id === 'node-000')).toBe(false);
    expect(capped.some((node) => node.id === 'node-319')).toBe(true);
    expect(capGraphNodes(many)).toEqual(capped);

    const layout = layoutBrainGraph(many, [], { width: 600, height: 400, iterations: 4 });
    expect(layout.nodes).toHaveLength(MAX_GRAPH_NODES);
  });
});

function placed(id: string, x: number, y: number, overrides: Partial<LayoutNode> = {}): LayoutNode {
  return { ...makeNode(id), x, y, radius: 10, ...overrides };
}

function labelHalf(label: string): number {
  return (label.length * 5.6) / 2;
}

describe('brain graph labels', () => {
  it('truncates a long label to the available width', () => {
    const node = placed('a', 120, 200, { label: 'x'.repeat(80) });
    const placement = labelPlacement(node, 240);

    expect(placement.label.length).toBeLessThan(80);
    expect(placement.label.endsWith('…')).toBe(true);
    expect(placement.label.length * 5.6).toBeLessThanOrEqual(240 - 8);
  });

  it('keeps the label box inside the viewport at either edge', () => {
    const left = labelPlacement(placed('l', 2, 200, { label: 'left edge label' }), 240);
    const right = labelPlacement(placed('r', 238, 200, { label: 'right edge label' }), 240);

    expect(2 + left.x - labelHalf(left.label)).toBeGreaterThanOrEqual(3.9);
    expect(238 + right.x + labelHalf(right.label)).toBeLessThanOrEqual(236.1);
  });

  it('drops the label below a node that sits near the top edge', () => {
    expect(labelPlacement(placed('top', 120, 4), 240).y).toBeGreaterThan(0);
    expect(labelPlacement(placed('low', 120, 120), 240).y).toBeLessThan(0);
  });
});

describe('brain graph keyboard navigation', () => {
  const cross = [
    placed('center', 100, 100),
    placed('right', 200, 100),
    placed('left', 0, 100),
    placed('up', 100, 0),
    placed('down', 100, 200),
  ];

  it('moves to the nearest node in each arrow direction', () => {
    expect(nextNodeInDirection(cross, 'center', 'right')).toBe('right');
    expect(nextNodeInDirection(cross, 'center', 'left')).toBe('left');
    expect(nextNodeInDirection(cross, 'center', 'up')).toBe('up');
    expect(nextNodeInDirection(cross, 'center', 'down')).toBe('down');
  });

  it('returns null when nothing lies ahead and for an unknown node', () => {
    expect(nextNodeInDirection(cross, 'right', 'right')).toBeNull();
    expect(nextNodeInDirection(cross, 'missing', 'down')).toBeNull();
  });
});
