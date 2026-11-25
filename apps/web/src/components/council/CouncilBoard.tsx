import type { GoalState, RpcResult, Task, TaskState } from '@tuffcode/contracts';
import { Badge, Button, cn } from '@tuffcode/ui';
import {
  Boxes,
  CircleSlash,
  Flag,
  Maximize2,
  Minus,
  Network,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useElementSize } from '../../hooks/use-element-size';
import {
  GOAL_STATE_LABEL,
  REVIEW_VERDICT_TONE,
  TASK_STATE_LABEL,
} from '../inspector/council-model';
import {
  COUNCIL_TONE_COLOR,
  MAX_BOARD_ZOOM,
  MIN_BOARD_ZOOM,
  clampZoom,
  councilBoardCounts,
  fitViewport,
  goalStateColor,
  layoutCouncilBoard,
  reportLabel,
  reportStateColor,
  reviewVerdictColor,
  reviewerChipLabel,
  reviewerLabel,
  taskStateColor,
  type BoardNode,
  type BoardViewport,
  type CouncilBoardCounts,
  type ReportNodeState,
} from './council-board';

export interface CouncilBoardProps {
  status: RpcResult<'council.status'> | null;
  /** Node whose details the panel is showing; null when nothing is selected. */
  selectedNodeId: string | null;
  onSelectNode: (node: BoardNode | null) => void;
  /** Click-through to the task's child thread. */
  onOpenTask: (task: Task) => void;
  onCancel: () => void;
  cancelling: boolean;
  /** False once the goal is terminal or absent. */
  canCancel: boolean;
  className?: string;
}

const NODE_ICON = {
  planner: Network,
  task: Boxes,
  reviewer: ShieldCheck,
  report: Flag,
} as const;

const ZOOM_STEP = 1.25;

/** The legend reads left to right in plan order: the planner, then task states. */
const LEGEND_ENTRIES: readonly { key: keyof CouncilBoardCounts; label: string; color: string }[] = [
  { key: 'planner', label: 'Planner', color: COUNCIL_TONE_COLOR.info },
  { key: 'queued', label: 'Queued', color: COUNCIL_TONE_COLOR.neutral },
  { key: 'running', label: 'Running', color: COUNCIL_TONE_COLOR.primary },
  { key: 'passed', label: 'Passed', color: COUNCIL_TONE_COLOR.success },
  { key: 'failed', label: 'Failed', color: COUNCIL_TONE_COLOR.error },
  { key: 'blocked', label: 'Blocked', color: COUNCIL_TONE_COLOR.warning },
];

function nodeStateLabel(node: BoardNode): string {
  if (node.kind === 'report') return reportLabel(node.state as ReportNodeState);
  if (node.kind === 'planner') return GOAL_STATE_LABEL[node.state as GoalState];
  if (node.kind === 'reviewer') return reviewerLabel(node);
  return TASK_STATE_LABEL[node.state as TaskState];
}

function nodeAccent(node: BoardNode): string {
  if (node.kind === 'report') return reportStateColor(node.state as ReportNodeState);
  if (node.kind === 'planner') return goalStateColor(node.state as GoalState);
  if (node.kind === 'reviewer' && node.verdict !== null) return reviewVerdictColor(node.verdict);
  return taskStateColor(node.state as TaskState);
}

/**
 * The council node board, decision D36: planner on top, task columns by
 * dependency depth, a reviewer chip under each task, the report at the end. Pan by
 * dragging the background, zoom with the controls or ctrl+wheel, fit with one
 * button. Hovering a node lifts its edges out of the dimmed remainder.
 */
export function CouncilBoard({
  status,
  selectedNodeId,
  onSelectNode,
  onOpenTask,
  onCancel,
  cancelling,
  canCancel,
  className,
}: CouncilBoardProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<BoardViewport>({ scale: 1, x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    from: BoardViewport;
  } | null>(null);

  const empty = status === null;
  const layout = useMemo(
    () => layoutCouncilBoard(status?.goal ?? null, status?.tasks ?? [], status?.reviews ?? []),
    [status],
  );
  const tasksById = useMemo(
    () => new Map((status?.tasks ?? []).map((task) => [task.id, task])),
    [status],
  );

  const activeId = hoveredId ?? selectedNodeId;
  const legend = councilBoardCounts(status?.goal ?? null, status?.tasks ?? []);

  const fit = useCallback(() => {
    if (size.width === 0 || size.height === 0) return;
    setViewport(fitViewport({ width: layout.width, height: layout.height }, size));
  }, [layout.width, layout.height, size]);

  // A new goal, a plan that grew, or a column that wrapped reframes the board. A
  // user's zoom survives while the plan keeps the same shape and the surface size.
  useEffect(() => {
    fit();
  }, [fit, layout.nodes.length]);

  const zoomAt = useCallback((factor: number, pointX: number, pointY: number) => {
    setViewport((current) => {
      const scale = clampZoom(current.scale * factor);
      if (scale === current.scale) return current;
      const ratio = scale / current.scale;
      return {
        scale,
        x: pointX - (pointX - current.x) * ratio,
        y: pointY - (pointY - current.y) * ratio,
      };
    });
  }, []);

  const zoomFromCenter = useCallback(
    (factor: number) => {
      zoomAt(factor, size.width / 2, size.height / 2);
    },
    [size.height, size.width, zoomAt],
  );

  // ctrl or cmd plus wheel zooms; a plain wheel is left alone so the surrounding
  // panel keeps scrolling.
  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    function handleWheel(event: WheelEvent): void {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = viewportRef.current;
      if (target === null) return;
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY / 320), event.clientX - rect.left, event.clientY - rect.top);
    }
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [zoomAt]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-board-node]') !== null) return;
    if (target.closest('button') !== null) return;
    onSelectNode(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: viewport,
    };
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    setViewport({
      scale: state.from.scale,
      x: state.from.x + (event.clientX - state.startX),
      y: state.from.y + (event.clientY - state.startY),
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleNodeClick(node: BoardNode): void {
    onSelectNode(node);
    if (node.kind !== 'task' || node.taskId === null) return;
    const task = tasksById.get(node.taskId);
    if (task !== undefined && task.threadId !== null) onOpenTask(task);
  }

  return (
    <div
      ref={ref}
      data-testid="council-board"
      data-node-count={layout.nodes.length}
      data-edge-count={layout.edges.length}
      data-columns={layout.columns}
      data-empty={empty ? 'true' : 'false'}
      data-zoom={viewport.scale.toFixed(2)}
      className={cn(
        'relative min-h-0 overflow-hidden bg-card',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={viewportRef}
        className="absolute inset-0 touch-none"
        role="group"
        aria-label={
          empty ? 'Council board, no goal yet' : `Council board with ${layout.nodes.length} nodes`
        }
      >
        {empty ? null : (
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0"
            >
              {layout.edges.map((edge) => {
                const active =
                  activeId !== null && (edge.from === activeId || edge.to === activeId);
                const dimmed = activeId !== null && !active;
                return (
                  <path
                    key={edge.id}
                    data-testid="council-board-edge"
                    data-kind={edge.kind}
                    data-active={active ? 'true' : 'false'}
                    d={edge.path}
                    fill="none"
                    stroke={active ? 'var(--primary)' : 'var(--muted-foreground)'}
                    strokeWidth={active ? 1.75 : 1}
                    strokeOpacity={active ? 0.95 : dimmed ? 0.12 : 0.35}
                    strokeDasharray={edge.kind === 'review' ? '3 3' : undefined}
                  />
                );
              })}
            </svg>

            {layout.nodes.map((node) => {
              const Icon = NODE_ICON[node.kind];
              const accent = nodeAccent(node);
              const selected = node.id === selectedNodeId;
              const task = node.taskId === null ? undefined : tasksById.get(node.taskId);
              const opensThread = node.kind === 'task' && task?.threadId !== null;
              const tooltip =
                node.kind === 'task' || node.kind === 'reviewer'
                  ? `${node.title}${node.model === null ? '' : ` · ${node.model}`}`
                  : node.kind === 'planner'
                    ? 'Planner: this goal thread turns the goal into tasks'
                    : 'Report: the goal summary at the end of the run';
              return (
                <button
                  key={node.id}
                  type="button"
                  data-board-node="true"
                  data-testid="council-board-node"
                  data-node-id={node.id}
                  data-kind={node.kind}
                  data-state={node.state}
                  data-verdict={node.verdict ?? undefined}
                  aria-pressed={selected}
                  aria-label={`${node.title} (${node.kind}, ${nodeStateLabel(node)})`}
                  title={tooltip}
                  className={cn(
                    'absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-background px-2 text-left outline-none',
                    'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                    node.kind === 'reviewer' ? 'border-dashed py-0.5' : 'py-1.5',
                    selected ? 'ring-2 ring-ring' : 'hover:bg-accent/60',
                    opensThread ? 'cursor-pointer' : 'cursor-default',
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    borderColor: selected ? 'var(--ring)' : 'var(--border)',
                    borderLeftColor: accent,
                    borderLeftWidth: 3,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNodeClick(node);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() =>
                    setHoveredId((current) => (current === node.id ? null : current))
                  }
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId((current) => (current === node.id ? null : current))}
                >
                  {node.kind === 'reviewer' ? (
                    <span className="flex min-w-0 items-center gap-1">
                      {node.verdict === null ? (
                        <span className="shrink-0 text-2xs font-medium" style={{ color: accent }}>
                          {reviewerChipLabel(node)}
                        </span>
                      ) : (
                        <Badge variant={REVIEW_VERDICT_TONE[node.verdict]} size="sm">
                          {reviewerChipLabel(node)}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <>
                      <span className="flex min-w-0 items-center gap-1">
                        <Icon
                          aria-hidden="true"
                          className="size-3 shrink-0"
                          style={{ color: accent }}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                          {node.title}
                        </span>
                        {node.critical ? (
                          <span
                            aria-label="Critical task"
                            className="size-1.5 shrink-0 rounded-full bg-warning"
                          />
                        ) : null}
                        {node.round > 0 ? (
                          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                            r{node.round}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
                        <span className="shrink-0 whitespace-nowrap" style={{ color: accent }}>
                          {nodeStateLabel(node)}
                        </span>
                        {node.model !== null ? (
                          <>
                            <span aria-hidden="true" className="text-muted-foreground/40">
                              ·
                            </span>
                            <span className="truncate font-mono">{node.model}</span>
                          </>
                        ) : null}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {empty ? (
        <div
          data-testid="council-board-empty"
          className="pointer-events-none absolute inset-0 grid place-items-center p-6"
        >
          <div className="flex max-w-60 flex-col items-center gap-1.5 text-center">
            <Network aria-hidden="true" className="size-5 text-muted-foreground" />
            <p className="text-xs font-medium text-foreground">No council goal yet</p>
            <p className="text-2xs leading-4 text-muted-foreground">
              Start a council goal from the thread composer. The board fills in with the plan, the
              workers, each review and the final report.
            </p>
          </div>
        </div>
      ) : null}

      {canCancel ? (
        <div className="absolute top-1.5 right-1.5">
          <Button
            size="sm"
            variant="outline"
            data-testid="council-board-cancel"
            disabled={cancelling}
            onClick={onCancel}
          >
            <CircleSlash strokeWidth={1.75} />
            Cancel
          </Button>
        </div>
      ) : null}

      {empty ? null : (
        <>
          <div
            data-testid="council-board-controls"
            className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5 rounded-md border border-border bg-background/90 p-0.5 backdrop-blur-sm"
          >
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom out"
              disabled={viewport.scale <= MIN_BOARD_ZOOM}
              onClick={() => zoomFromCenter(1 / ZOOM_STEP)}
            >
              <Minus strokeWidth={1.75} />
            </Button>
            <span className="w-9 text-center text-2xs tabular-nums text-muted-foreground">
              {Math.round(viewport.scale * 100)}%
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom in"
              disabled={viewport.scale >= MAX_BOARD_ZOOM}
              onClick={() => zoomFromCenter(ZOOM_STEP)}
            >
              <Plus strokeWidth={1.75} />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Fit board" onClick={fit}>
              <Maximize2 strokeWidth={1.75} />
            </Button>
          </div>

          <div
            data-testid="council-board-legend"
            className="pointer-events-none absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-9rem)] flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground"
          >
            {LEGEND_ENTRIES.map((entry) => (
              <span
                key={entry.key}
                data-legend={entry.key}
                className="flex items-center gap-1 whitespace-nowrap"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span>{entry.label}</span>
                <span className="tabular-nums text-foreground">{legend[entry.key]}</span>
              </span>
            ))}
            <span className="whitespace-nowrap tabular-nums text-muted-foreground/60">
              {layout.nodes.length} nodes · {layout.edges.length} edges
            </span>
          </div>
        </>
      )}
    </div>
  );
}
