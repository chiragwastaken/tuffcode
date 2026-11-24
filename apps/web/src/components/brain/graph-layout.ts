import type { BrainKind } from '@tuffcode/contracts';

/**
 * Deterministic force layout for the brain graph, spec section 7.7.
 *
 * No dependency and no randomness: seeds come from the node index on a golden-angle
 * spiral, the Fruchterman-Reingold pass runs a fixed iteration count, and ties break
 * on id. The same nodes, edges and viewport therefore always produce the same
 * picture, which is what makes the graph stable across re-renders and testable
 * without a browser.
 */
export const MAX_GRAPH_NODES = 300;
export const MIN_NODE_RADIUS = 6;
export const MAX_NODE_RADIUS = 14;
export const LAYOUT_ITERATIONS = 160;

const PADDING = 18;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_DISTANCE = 0.5;
const GRAVITY = 0.02;
const WALL_STRENGTH = 0.35;
const MAX_FIT_SCALE = 4;

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

export interface LayoutNode extends BrainGraphNode {
  x: number;
  y: number;
  radius: number;
}

export interface BrainGraphLayout {
  nodes: LayoutNode[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/** Math.hypot is an order of magnitude slower than this and the loop is hot. */
function vectorLength(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Importance maps linearly onto the 6 to 14px circle range from the spec. */
export function nodeRadius(importance: number): number {
  const value = Number.isFinite(importance) ? clamp(importance, 0, 1) : 0;
  return MIN_NODE_RADIUS + (MAX_NODE_RADIUS - MIN_NODE_RADIUS) * value;
}

const LABEL_CHAR_WIDTH = 5.6;
const LABEL_MAX_CHARS = 44;
const LABEL_GAP = 4;
const LABEL_LINE_HEIGHT = 11;

/** At rest only the best-connected nodes carry a label, cut to this many characters. */
export const RESTING_LABEL_MAX = 14;
export const RESTING_LABEL_LIMIT = 8;

/**
 * The nodes that keep a label when nothing is hovered: the best connected first,
 * then the most important, then the lowest id. Deterministic for a stable picture.
 */
export function topLabelNodeIds(
  nodes: readonly BrainGraphNode[],
  limit: number = RESTING_LABEL_LIMIT,
): Set<string> {
  return new Set(
    [...nodes]
      .toSorted(
        (a, b) => b.degree - a.degree || b.importance - a.importance || a.id.localeCompare(b.id),
      )
      .slice(0, Math.max(0, limit))
      .map((node) => node.id),
  );
}

export interface GraphLabelPlacement {
  label: string;
  x: number;
  y: number;
  anchor: 'middle';
}

/**
 * Places a hover label so it never leaves the viewport: truncate to the measured
 * budget, center on the node, clamp horizontally, and drop below a node near the
 * top edge. The graph is often only a few hundred pixels wide, so a fixed
 * character cap alone would still clip.
 */
export function labelPlacement(
  node: LayoutNode,
  width: number,
  maxChars: number = LABEL_MAX_CHARS,
): GraphLabelPlacement {
  const budget = Math.max(8, Math.floor((width - LABEL_GAP * 2) / LABEL_CHAR_WIDTH));
  const limit = Math.min(maxChars, budget);
  const label =
    node.label.length > limit ? `${node.label.slice(0, Math.max(1, limit - 1))}…` : node.label;

  const half = (label.length * LABEL_CHAR_WIDTH) / 2;
  const minX = LABEL_GAP + half - node.x;
  const maxX = width - LABEL_GAP - half - node.x;
  const x = minX > maxX ? width / 2 - node.x : clamp(0, minX, maxX);
  const fitsAbove = node.y - node.radius - LABEL_LINE_HEIGHT - LABEL_GAP > 0;

  return {
    label,
    x,
    y: fitsAbove ? -(node.radius + 6) : node.radius + LABEL_LINE_HEIGHT + LABEL_GAP,
    anchor: 'middle',
  };
}

export type GraphDirection = 'left' | 'right' | 'up' | 'down';

/**
 * The next node for an arrow key: the nearest node in that direction, scoring
 * forward distance with a two-times lateral penalty so a mostly-sideways node is
 * not picked over one directly ahead. Ties break on id for determinism.
 */
export function nextNodeInDirection(
  nodes: readonly LayoutNode[],
  currentId: string,
  direction: GraphDirection,
): string | null {
  const current = nodes.find((node) => node.id === currentId);
  if (current === undefined) return null;

  let bestId: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (node.id === current.id) continue;
    const dx = node.x - current.x;
    const dy = node.y - current.y;
    const forward =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'up' ? -dy : dy;
    if (forward <= 0) continue;
    const lateral = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = forward + lateral * 2;
    if (score < bestScore || (score === bestScore && bestId !== null && node.id < bestId)) {
      bestScore = score;
      bestId = node.id;
    }
  }
  return bestId;
}

/**
 * Keeps the graph renderable when a caller ignores the server cap: the most
 * important nodes survive, then the best connected, then the lowest id.
 */
export function capGraphNodes(
  nodes: readonly BrainGraphNode[],
  cap: number = MAX_GRAPH_NODES,
): BrainGraphNode[] {
  if (nodes.length <= cap) return [...nodes];
  return [...nodes]
    .toSorted(
      (a, b) => b.importance - a.importance || b.degree - a.degree || a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, cap));
}

/** The selected node plus every node sharing an edge with it. */
export function highlightedNodeIds(
  selectedId: string | null,
  edges: readonly BrainGraphEdge[],
): Set<string> {
  const highlighted = new Set<string>();
  if (selectedId === null) return highlighted;
  highlighted.add(selectedId);
  for (const edge of edges) {
    if (edge.from === selectedId) highlighted.add(edge.to);
    else if (edge.to === selectedId) highlighted.add(edge.from);
  }
  return highlighted;
}

/** Edges worth drawing: both endpoints exist and the line has length. */
export function drawableEdges(
  edges: readonly BrainGraphEdge[],
  nodeIds: ReadonlySet<string>,
): BrainGraphEdge[] {
  return edges.filter(
    (edge) => edge.from !== edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
}

export function layoutBrainGraph(
  nodes: readonly BrainGraphNode[],
  edges: readonly BrainGraphEdge[],
  options: LayoutOptions,
): BrainGraphLayout {
  const width = Math.max(0, options.width);
  const height = Math.max(0, options.height);
  const capped = capGraphNodes(nodes);
  if (width === 0 || height === 0 || capped.length === 0) {
    return { nodes: [], width, height };
  }

  const count = capped.length;
  const iterations = Math.max(0, Math.floor(options.iterations ?? LAYOUT_ITERATIONS));
  const innerWidth = Math.max(1, width - PADDING * 2);
  const innerHeight = Math.max(1, height - PADDING * 2);
  const centerX = width / 2;
  const centerY = height / 2;
  const spread = Math.min(innerWidth, innerHeight) * 0.42;

  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const angle = index * GOLDEN_ANGLE;
    const ring = spread * Math.sqrt((index + 0.5) / count);
    xs[index] = centerX + ring * Math.cos(angle);
    ys[index] = centerY + ring * Math.sin(angle);
  }
  if (count === 1) {
    xs[0] = centerX;
    ys[0] = centerY;
  }

  const indexById = new Map<string, number>();
  for (let index = 0; index < count; index += 1) indexById.set(capped[index]!.id, index);
  const springs: Array<readonly [number, number]> = [];
  for (const edge of edges) {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    springs.push([from, to]);
  }

  const area = innerWidth * innerHeight;
  const k = Math.sqrt(area / count);
  const kSquared = k * k;
  const displacementsX = new Float64Array(count);
  const displacementsY = new Float64Array(count);
  const temperatureStart = Math.min(innerWidth, innerHeight) / 6;
  const minX = Math.min(PADDING, width);
  const minY = Math.min(PADDING, height);
  const maxX = Math.max(minX, width - PADDING);
  const maxY = Math.max(minY, height - PADDING);

  for (let step = 0; step < iterations; step += 1) {
    displacementsX.fill(0);
    displacementsY.fill(0);

    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        let dx = xs[a]! - xs[b]!;
        let dy = ys[a]! - ys[b]!;
        let distance = vectorLength(dx, dy);
        if (distance < MIN_DISTANCE) {
          // Deterministic nudge so coincident nodes separate without randomness.
          const angle = (a * 2.399_963 + b * 1.618_034) % (Math.PI * 2);
          dx = Math.cos(angle) * MIN_DISTANCE;
          dy = Math.sin(angle) * MIN_DISTANCE;
          distance = MIN_DISTANCE;
        }
        const force = kSquared / distance;
        const forceX = (dx / distance) * force;
        const forceY = (dy / distance) * force;
        displacementsX[a]! += forceX;
        displacementsY[a]! += forceY;
        displacementsX[b]! -= forceX;
        displacementsY[b]! -= forceY;
      }
    }

    for (const [from, to] of springs) {
      let dx = xs[from]! - xs[to]!;
      let dy = ys[from]! - ys[to]!;
      let distance = vectorLength(dx, dy);
      if (distance < MIN_DISTANCE) {
        dx = MIN_DISTANCE;
        dy = 0;
        distance = MIN_DISTANCE;
      }
      const force = (distance * distance) / k;
      const forceX = (dx / distance) * force;
      const forceY = (dy / distance) * force;
      displacementsX[from]! -= forceX;
      displacementsY[from]! -= forceY;
      displacementsX[to]! += forceX;
      displacementsY[to]! += forceY;
    }

    for (let index = 0; index < count; index += 1) {
      displacementsX[index]! += (centerX - xs[index]!) * GRAVITY;
      displacementsY[index]! += (centerY - ys[index]!) * GRAVITY;
    }

    // Soft walls: push back in proportion to the overshoot instead of clamping.
    // A hard clamp piles every outward-pushed node onto the viewport edge, which
    // collapses a narrow panel into two vertical rails.
    for (let index = 0; index < count; index += 1) {
      const x = xs[index]!;
      const y = ys[index]!;
      if (x < minX) displacementsX[index]! += (minX - x) * WALL_STRENGTH;
      else if (x > maxX) displacementsX[index]! += (maxX - x) * WALL_STRENGTH;
      if (y < minY) displacementsY[index]! += (minY - y) * WALL_STRENGTH;
      else if (y > maxY) displacementsY[index]! += (maxY - y) * WALL_STRENGTH;
    }

    // Linear cooling: early steps move freely, late steps only settle.
    const temperature = Math.max(0.1, temperatureStart * (1 - step / iterations));
    for (let index = 0; index < count; index += 1) {
      const dx = displacementsX[index]!;
      const dy = displacementsY[index]!;
      const length = vectorLength(dx, dy);
      if (length > 0) {
        const scale = Math.min(length, temperature) / length;
        xs[index] = xs[index]! + dx * scale;
        ys[index] = ys[index]! + dy * scale;
      }
    }
  }

  // Fit the settled graph into the viewport with one uniform scale, so the
  // structure is preserved and every node and its circle stay inside the panel.
  let minPosX = Number.POSITIVE_INFINITY;
  let maxPosX = Number.NEGATIVE_INFINITY;
  let minPosY = Number.POSITIVE_INFINITY;
  let maxPosY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    minPosX = Math.min(minPosX, xs[index]!);
    maxPosX = Math.max(maxPosX, xs[index]!);
    minPosY = Math.min(minPosY, ys[index]!);
    maxPosY = Math.max(maxPosY, ys[index]!);
  }

  const inset = PADDING + MAX_NODE_RADIUS;
  const usableWidth = Math.max(1, width - inset * 2);
  const usableHeight = Math.max(1, height - inset * 2);
  const spanX = maxPosX - minPosX;
  const spanY = maxPosY - minPosY;
  const fit = Math.min(
    spanX > 1e-6 ? usableWidth / spanX : Number.POSITIVE_INFINITY,
    spanY > 1e-6 ? usableHeight / spanY : Number.POSITIVE_INFINITY,
  );
  const scale = Number.isFinite(fit) ? Math.min(fit, MAX_FIT_SCALE) : 1;
  const offsetX = inset + (usableWidth - spanX * scale) / 2 - minPosX * scale;
  const offsetY = inset + (usableHeight - spanY * scale) / 2 - minPosY * scale;
  const radii = capped.map((node) => nodeRadius(node.importance));

  for (let index = 0; index < count; index += 1) {
    xs[index] = xs[index]! * scale + offsetX;
    ys[index] = ys[index]! * scale + offsetY;
  }

  // A few relaxation passes remove the rare overlapping pair the force pass leaves
  // behind, so circles never sit on top of each other. Deterministic and bounded.
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        let dx = xs[a]! - xs[b]!;
        let dy = ys[a]! - ys[b]!;
        let distance = vectorLength(dx, dy);
        const minimum = radii[a]! + radii[b]! + 2;
        if (distance >= minimum) continue;
        if (distance < 1e-6) {
          const angle = (a * 2.399_963 + b * 1.618_034) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (minimum - distance) / 2;
        const unitX = dx / distance;
        const unitY = dy / distance;
        xs[a] = clamp(xs[a]! + unitX * push, PADDING, maxX);
        ys[a] = clamp(ys[a]! + unitY * push, PADDING, maxY);
        xs[b] = clamp(xs[b]! - unitX * push, PADDING, maxX);
        ys[b] = clamp(ys[b]! - unitY * push, PADDING, maxY);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return {
    nodes: capped.map((node, index) => ({
      ...node,
      x: xs[index]!,
      y: ys[index]!,
      radius: radii[index]!,
    })),
    width,
    height,
  };
}
