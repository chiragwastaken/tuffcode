import { Button } from '@tuffcode/ui';
import { useMemo, useRef, useState } from 'react';
import { useElementSize } from '../../hooks/use-element-size';
import {
  drawableEdges,
  highlightedNodeIds,
  labelPlacement,
  layoutBrainGraph,
  nextNodeInDirection,
  type BrainGraphEdge,
  type BrainGraphNode,
  type GraphDirection,
} from './graph-layout';
import { BRAIN_KIND_COLOR } from './graph-style';

export interface BrainGraphProps {
  nodes: readonly BrainGraphNode[];
  edges: readonly BrainGraphEdge[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string | null) => void;
  onRetry: () => void;
}

const SKELETON_POINTS = [
  { x: 22, y: 30 },
  { x: 44, y: 14 },
  { x: 62, y: 34 },
  { x: 78, y: 18 },
  { x: 30, y: 62 },
  { x: 52, y: 52 },
  { x: 70, y: 66 },
  { x: 40, y: 82 },
  { x: 64, y: 88 },
];

const LABEL_KEYS: Record<string, GraphDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * The SVG graph: 1px edges at 40 percent opacity, kind-colored nodes sized by
 * importance, hover labels, and a selected node with its neighbors lifted out of
 * the dimmed remainder. Clicking empty space clears the selection.
 */
export function BrainGraph({
  nodes,
  edges,
  selectedId,
  loading,
  error,
  onSelect,
  onRetry,
}: BrainGraphProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());

  const layout = useMemo(
    () => layoutBrainGraph(nodes, edges, { width: size.width, height: size.height }),
    [nodes, edges, size.width, size.height],
  );
  const nodeIds = useMemo(() => new Set(layout.nodes.map((node) => node.id)), [layout]);
  const lines = useMemo(() => drawableEdges(edges, nodeIds), [edges, nodeIds]);
  const highlighted = useMemo(() => highlightedNodeIds(selectedId, edges), [selectedId, edges]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);

  // A roving tabindex keeps one graph stop: Tab reaches the graph once, then the
  // arrow keys move between nodes instead of burying the details actions.
  const tabbableId =
    selectedId !== null && nodeIds.has(selectedId) ? selectedId : (layout.nodes[0]?.id ?? null);
  const hasVisibleSelection = selectedId !== null && nodeIds.has(selectedId);

  const showSkeleton = loading && nodes.length === 0;
  const showEmpty = !loading && error === null && nodes.length === 0;

  return (
    <div
      ref={ref}
      data-testid="brain-graph"
      data-node-count={nodes.length}
      data-edge-count={lines.length}
      className="relative size-full min-h-0 overflow-hidden bg-card"
    >
      {size.width > 0 && size.height > 0 ? (
        <svg
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="img"
          aria-label={`Brain graph with ${nodes.length} nodes and ${lines.length} edges`}
          className="block touch-none"
        >
          <rect
            width={size.width}
            height={size.height}
            fill="transparent"
            onClick={() => onSelect(null)}
          />

          <g aria-hidden="true">
            {lines.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (from === undefined || to === undefined) return null;
              const active =
                hasVisibleSelection && (edge.from === selectedId || edge.to === selectedId);
              const dimmed = hasVisibleSelection && !active;
              return (
                <line
                  key={`${edge.from}->${edge.to}:${edge.relation}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={active ? 'var(--primary)' : 'var(--muted-foreground)'}
                  strokeWidth={1}
                  strokeOpacity={active ? 0.9 : dimmed ? 0.15 : 0.4}
                />
              );
            })}
          </g>

          <g>
            {layout.nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const isHighlighted = highlighted.has(node.id);
              const dimmed = hasVisibleSelection && !isHighlighted;
              const isFocused = focusedId === node.id;
              const placement = labelPlacement(node, layout.width);
              const showLabel = hoveredId === node.id || isSelected;
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    if (element === null) nodeRefs.current.delete(node.id);
                    else nodeRefs.current.set(node.id, element);
                  }}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex={node.id === tabbableId ? 0 : -1}
                  aria-label={`${node.label} (${node.kind})`}
                  aria-pressed={isSelected}
                  data-testid="brain-graph-node"
                  data-node-id={node.id}
                  data-kind={node.kind}
                  data-selected={isSelected ? 'true' : 'false'}
                  className="cursor-pointer outline-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(node.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(node.id);
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onSelect(null);
                      return;
                    }
                    const direction = LABEL_KEYS[event.key];
                    if (direction === undefined) return;
                    const nextId = nextNodeInDirection(layout.nodes, node.id, direction);
                    if (nextId === null) return;
                    event.preventDefault();
                    nodeRefs.current.get(nextId)?.focus();
                  }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() =>
                    setHoveredId((current) => (current === node.id ? null : current))
                  }
                  onFocus={() => {
                    setFocusedId(node.id);
                    setHoveredId(node.id);
                  }}
                  onBlur={() => {
                    setFocusedId((current) => (current === node.id ? null : current));
                    setHoveredId((current) => (current === node.id ? null : current));
                  }}
                >
                  {isFocused ? (
                    <circle r={node.radius + 5} fill="none" stroke="var(--ring)" strokeWidth={2} />
                  ) : null}
                  {isHighlighted && !dimmed ? (
                    <circle
                      r={node.radius + (isSelected ? 3.5 : 2.5)}
                      fill="none"
                      stroke={isSelected ? 'var(--foreground)' : 'var(--primary)'}
                      strokeWidth={isSelected ? 2 : 1.5}
                      strokeOpacity={isSelected ? 1 : 0.6}
                    />
                  ) : null}
                  <circle
                    r={node.radius}
                    fill={BRAIN_KIND_COLOR[node.kind]}
                    fillOpacity={dimmed ? 0.45 : 1}
                  />
                  {showLabel ? (
                    <text
                      x={placement.x}
                      y={placement.y}
                      textAnchor={placement.anchor}
                      fontSize={11}
                      fontWeight={500}
                      fill="var(--foreground)"
                      stroke="var(--card)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="pointer-events-none select-none"
                    >
                      {placement.label}
                    </text>
                  ) : (
                    <title>{node.label}</title>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}

      {showSkeleton ? (
        <div
          data-testid="brain-graph-skeleton"
          aria-label="Loading brain graph"
          className="absolute inset-0 grid place-items-center"
        >
          <div className="relative size-40 animate-pulse">
            {SKELETON_POINTS.map((point, index) => (
              <span
                key={index}
                className="absolute size-3 rounded-full bg-muted"
                style={{ left: `${String(point.x)}%`, top: `${String(point.y)}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <div className="absolute inset-0 grid place-items-center bg-card/80 p-4">
          <div className="flex max-w-56 flex-col items-center gap-2 text-center">
            <p role="alert" className="text-xs text-error">
              {error}
            </p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {showEmpty ? (
        <div
          data-testid="brain-graph-empty"
          className="absolute inset-0 grid place-items-center p-4 text-center"
        >
          <div className="flex max-w-56 flex-col gap-1">
            <p className="text-xs font-medium text-foreground">No entries to graph yet</p>
            <p className="text-2xs leading-4 text-muted-foreground">
              Rules, preferences and project notes appear here as they are learned or added.
            </p>
          </div>
        </div>
      ) : null}

      {nodes.length > 0 && error === null ? (
        <div className="pointer-events-none absolute bottom-1.5 left-2 text-2xs tabular-nums text-muted-foreground">
          {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {lines.length}{' '}
          {lines.length === 1 ? 'edge' : 'edges'}
        </div>
      ) : null}
    </div>
  );
}
