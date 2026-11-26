import type { Thread } from '@tuffcode/contracts';
import {
  IconButton,
  PopoverClose,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  buttonVariants,
  cn,
  focusRing,
} from '@tuffcode/ui';
import { Columns2, GripVertical, Plus, X, type LucideIcon } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useAppStore } from '../../store/app-store';
import { requestTerminalAt } from '../terminal/terminal-requests';
import {
  MAX_PANES,
  MIN_PANE_WIDTH_PX,
  NARROW_PANE_WIDTH_PX,
  SPLITTER_WIDTH_PX,
  THREAD_DRAG_MIME,
  addTab,
  availableSurfaces,
  closeLeaf,
  closeTab,
  collapseForNarrow,
  findPane,
  focusPane,
  isPaneSurface,
  leafCount,
  leafNode,
  leafNeighbor,
  leaves,
  loadPaneLayout,
  moveLeaf,
  moveTab,
  paneIdOfSurface,
  paneSurfaceLabel,
  resetSplit,
  resizeSplit,
  savePaneLayout,
  selectTab,
  splitLeaf,
  threadSurface,
  type PaneDirection,
  type PaneDropZone,
  type PaneLayout,
  type PaneLayoutPane,
  type PaneNode,
  type PaneSplit,
  type PaneSurface,
} from './pane-model';
import { PaneSurfaceView, paneSurfaceIcon } from './pane-surfaces';
import { subscribePaneRequests, takePaneRequest } from './pane-requests';

/** The drag payload a pane tab carries; the drop zone reads it. */
const PANE_TAB_MIME = 'application/x-tuffcode-pane-tab';
/** The drag payload a pane header carries: the whole leaf, every tab. */
const PANE_LEAF_MIME = 'application/x-tuffcode-pane-leaf';
/** The share of a leaf's edge that starts a split instead of a tab drop. */
const DROP_EDGE_RATIO = 0.25;

export interface PaneWorkspaceProps {
  threadId: string;
  thread?: Thread;
  projectName?: string;
}

type DragKind = 'tab' | 'leaf' | 'thread';

type DragPayload =
  | { kind: 'tab'; paneId: string; surface: PaneSurface }
  | { kind: 'leaf'; paneId: string }
  | { kind: 'thread'; threadId: string };

interface DropTarget {
  paneId: string;
  zone: PaneDropZone;
  /** Insertion point among the target header's tabs, for a center drop. */
  index: number;
}

const ZONE_CLASS: Record<PaneDropZone, string> = {
  left: 'inset-y-0 left-0 w-1/4',
  right: 'inset-y-0 right-0 w-1/4',
  top: 'inset-x-0 top-0 h-1/4',
  bottom: 'inset-x-0 bottom-0 h-1/4',
  center: 'inset-[25%]',
};

/**
 * The thread row as a binary tree of one to four tiles. The first leaf always
 * hosts the thread; every other leaf shows a tool surface or another chat. Each
 * leaf is a full session surface with its own header, tabs and composer. Layout
 * persists per thread, and below 1100px the row keeps one leaf whose tabs are
 * every open surface.
 */
export function PaneWorkspace({ threadId, thread, projectName }: PaneWorkspaceProps) {
  const [layout, setLayout] = useState<PaneLayout>(() => loadPaneLayout(threadId));
  const [narrowTab, setNarrowTab] = useState<PaneSurface | null>(null);
  const [dragKind, setDragKind] = useState<DragKind | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const threadStageRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(containerRef);

  const closeSubagentPane = useAppStore((state) => state.closeSubagentPane);
  const subagentPaneOpen = useAppStore((state) => state.subagentPane.open);

  useEffect(() => {
    savePaneLayout(threadId, layout);
  }, [threadId, layout]);

  const narrow = width > 0 && width < NARROW_PANE_WIDTH_PX;
  const collapsed = narrow ? collapseForNarrow(layout) : null;
  const collapsedRoot = collapsed === null ? null : withActiveTab(collapsed.root, narrowTab);
  const root: PaneNode = collapsedRoot ?? layout.root;
  const focusedPaneId =
    narrow && root.kind === 'leaf' ? root.pane.id : layout.focusedPaneId;
  const hasSubagentSurface = paneIdOfSurface(layout, 'subagent') !== null;
  const externalSubagentPane =
    hasSubagentSurface && (!narrow || narrowTab === 'subagent' || narrowTab === null);
  const openPaneSurfaces = availableSurfaces(layout);
  const canSplit = leafCount(layout.root) < MAX_PANES && openPaneSurfaces.length > 0;

  /** Applies a new tree, keeping the narrow tab valid and the save effect honest. */
  const apply = useCallback((next: PaneLayout) => {
    if (next.root === layout.root && next.focusedPaneId === layout.focusedPaneId) return;
    setLayout(next);
  }, [layout]);

  const focus = useCallback(
    (paneId: string) => {
      const next = focusPane(layout, paneId);
      if (next !== layout) setLayout(next);
    },
    [layout],
  );

  const selectSurface = useCallback(
    (paneId: string, surface: PaneSurface) => {
      if (narrow) {
        const owner = paneIdOfSurface(layout, surface);
        setNarrowTab(surface);
        if (owner !== null) setLayout(selectTab(layout, owner, surface));
        return;
      }
      setLayout(selectTab(layout, paneId, surface));
    },
    [layout, narrow],
  );

  const closeSurface = useCallback(
    (paneId: string, surface: PaneSurface) => {
      const owner = narrow ? paneIdOfSurface(layout, surface) : paneId;
      if (owner === null) return;
      const next = closeTab(layout, owner, surface);
      if (next === layout) return;
      setLayout(next);
      if (narrow) setNarrowTab(null);
    },
    [layout, narrow],
  );

  const addSurface = useCallback(
    (paneId: string, surface: PaneSurface) => {
      const owner = paneIdOfSurface(layout, surface);
      if (owner !== null) {
        selectSurface(owner, surface);
        return;
      }
      const target = narrow ? leaves(layout)[0]!.id : paneId;
      const next = addTab(layout, target, surface);
      if (next === layout) return;
      setLayout(next);
      if (narrow) setNarrowTab(surface);
    },
    [layout, narrow, selectSurface],
  );

  const splitSurface = useCallback(
    (paneId: string, surface: PaneSurface) => {
      const next = splitLeaf(layout, narrow ? leaves(layout)[0]!.id : paneId, 'right', surface);
      if (next === layout) return;
      setLayout(next);
      if (narrow) setNarrowTab(surface);
    },
    [layout, narrow],
  );

  const closePane = useCallback(
    (paneId: string) => {
      const next = closeLeaf(layout, paneId);
      if (next === layout) return;
      setLayout(next);
      if (narrow) setNarrowTab(null);
    },
    [layout, narrow],
  );

  const closeSubagent = useCallback(() => {
    const owner = paneIdOfSurface(layout, 'subagent');
    closeSubagentPane();
    if (owner !== null) closeSurface(owner, 'subagent');
  }, [closeSubagentPane, closeSurface, layout]);

  // Opening a child from the timeline or its strip raises the surface's leaf.
  // Only the closed-to-open transition acts, so the user can tab away while a
  // child is still running.
  const wasSubagentOpen = useRef(false);
  useEffect(() => {
    const opened = subagentPaneOpen && !wasSubagentOpen.current;
    wasSubagentOpen.current = subagentPaneOpen;
    if (!opened) return;
    const owner = paneIdOfSurface(layout, 'subagent');
    if (owner === null) return;
    const pane = findPane(layout.root, owner);
    if (pane === null || pane.activeTab === 'subagent') return;
    setLayout(selectTab(layout, owner, 'subagent'));
    if (narrow) setNarrowTab('subagent');
  }, [layout, narrow, subagentPaneOpen]);

  // The toolbar's + menu asks for a side chat or a split; open it, or bring it forward.
  useEffect(
    () =>
      subscribePaneRequests(() => {
        const request = takePaneRequest();
        if (request === null) return;
        const surface =
          request.kind === 'side-chat' ? threadSurface(request.threadId) : request.surface;
        const owner = paneIdOfSurface(layout, surface);
        if (owner !== null) {
          setLayout(selectTab(layout, owner, surface));
          if (narrow) setNarrowTab(surface);
          return;
        }
        if (leafCount(layout.root) < MAX_PANES) {
          splitSurface(narrow ? leaves(layout)[0]!.id : layout.focusedPaneId, surface);
          return;
        }
        const last = leaves(layout).at(-1);
        if (last !== undefined) addSurface(last.id, surface);
      }),
    [addSurface, layout, narrow, splitSurface],
  );

  const openInTerminal = useCallback(
    (paneId: string, path: string) => {
      addSurface(paneId, 'terminal');
      requestTerminalAt(path);
    },
    [addSurface],
  );

  const clearDrag = useCallback(() => {
    setDragKind(null);
    setDropTarget(null);
  }, []);

  useEffect(() => {
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    return () => {
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
    };
  }, [clearDrag]);

  const dragStart = useCallback((event: DragEvent<HTMLElement>, payload: DragPayload) => {
    const transfer = event.dataTransfer;
    if (payload.kind === 'tab') {
      if (payload.surface === 'thread') {
        event.preventDefault();
        return;
      }
      transfer.effectAllowed = 'move';
      transfer.setData(
        PANE_TAB_MIME,
        JSON.stringify({ paneId: payload.paneId, surface: payload.surface }),
      );
      transfer.setData('text/plain', paneSurfaceLabel(payload.surface));
      setDragKind('tab');
      return;
    }
    // A thread row is the sidebar's drag source, never a pane header's.
    if (payload.kind === 'thread') {
      event.preventDefault();
      return;
    }
    transfer.effectAllowed = 'move';
    transfer.setData(PANE_LEAF_MIME, JSON.stringify({ paneId: payload.paneId }));
    transfer.setData('text/plain', 'Pane');
    setDragKind('leaf');
  }, []);

  const leafDragOver = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    const kind = dragKindOf(event.dataTransfer);
    if (kind === null) return;
    event.preventDefault();
    // A copy from the sidebar, a move inside the row. The drop only fires when
    // the effect matches what the source allowed.
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = kind === 'thread' ? 'copy' : 'move';
    setDragKind(kind);
    const leaf = event.currentTarget;
    const zone = narrow ? 'center' : zoneAt(leaf, event.clientX, event.clientY);
    const index = zone === 'center' ? dropIndexAt(leaf, event.clientX) : -1;
    setDropTarget((current) =>
      current !== null && current.paneId === paneId && current.zone === zone && current.index === index
        ? current
        : { paneId, zone, index },
    );
  }, [narrow]);

  const leafDragLeave = useCallback((event: DragEvent<HTMLElement>, paneId: string) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget((current) => (current !== null && current.paneId === paneId ? null : current));
  }, []);

  const leafDrop = useCallback(
    (event: DragEvent<HTMLElement>, paneId: string) => {
      const kind = dragKindOf(event.dataTransfer);
      if (kind === null) return;
      event.preventDefault();
      const leaf = event.currentTarget;
      const zone = narrow ? 'center' : zoneAt(leaf, event.clientX, event.clientY);
      const index = zone === 'center' ? dropIndexAt(leaf, event.clientX) : -1;
      const payload = readPayload(event.dataTransfer);
      clearDrag();
      if (payload === null) return;

      if (payload.kind === 'leaf') {
        if (zone === 'center') {
          focus(paneId);
          return;
        }
        apply(moveLeaf(layout, payload.paneId, paneId, zone));
        return;
      }

      const surface =
        payload.kind === 'thread' ? threadSurface(payload.threadId) : payload.surface;
      const target = narrow ? leaves(layout)[0]!.id : paneId;
      if (zone === 'center') {
        const owner = paneIdOfSurface(layout, surface);
        // A tab dragged from another leaf lands at the drop position.
        if (payload.kind === 'tab' && owner !== null && owner !== target) {
          const moved = moveTab(layout, owner, surface, target, index);
          if (moved !== layout) {
            setLayout(moved);
            if (narrow) setNarrowTab(surface);
            return;
          }
        }
        if (owner !== null) {
          setLayout(selectTab(focusPane(layout, owner), owner, surface));
          if (narrow) setNarrowTab(surface);
          return;
        }
        const next = addTab(layout, target, surface);
        if (next === layout) return;
        setLayout(next);
        if (narrow) setNarrowTab(surface);
        return;
      }
      const next = splitLeaf(layout, paneId, zone, surface);
      if (next === layout) return;
      setLayout(next);
      if (narrow) setNarrowTab(surface);
    },
    [apply, clearDrag, focus, layout, narrow],
  );

  const resizeRef = useRef<{
    splitId: string;
    horizontal: boolean;
    startX: number;
    startY: number;
    startLayout: PaneLayout;
    extent: number;
  } | null>(null);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, split: PaneSplit) => {
      if (event.button !== 0) return;
      const container = event.currentTarget.parentElement;
      if (container === null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const box = container.getBoundingClientRect();
      const horizontal = split.orientation === 'horizontal';
      resizeRef.current = {
        splitId: split.id,
        horizontal,
        startX: event.clientX,
        startY: event.clientY,
        startLayout: layout,
        extent: Math.max(0, (horizontal ? box.width : box.height) - SPLITTER_WIDTH_PX),
      };
    },
    [layout],
  );

  const moveResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, splitId: string) => {
    const drag = resizeRef.current;
    if (drag === null || drag.splitId !== splitId) return;
    const delta = drag.horizontal ? event.clientX - drag.startX : event.clientY - drag.startY;
    setLayout(resizeSplit(drag.startLayout, splitId, delta, drag.extent));
  }, []);

  const endResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, splitId: string) => {
    if (resizeRef.current?.splitId !== splitId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const nudgeSplit = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, split: PaneSplit, step: number) => {
      const container = event.currentTarget.parentElement;
      if (container === null) return;
      const box = container.getBoundingClientRect();
      const horizontal = split.orientation === 'horizontal';
      const extent = Math.max(0, (horizontal ? box.width : box.height) - SPLITTER_WIDTH_PX);
      const back = horizontal ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
      setLayout(resizeSplit(layout, split.id, back ? -step : step, extent));
    },
    [layout],
  );

  // Ctrl/Cmd+\ splits with the next surface; Ctrl/Cmd+W closes the focused leaf;
  // Alt+Arrow walks the focus between leaves. The chords yield to text fields and
  // terminals, where they mean edit, signal or word-jump.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return;

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const direction = ARROW_DIRECTION[event.key];
        if (direction === undefined) return;
        const next = leafNeighbor(layout.root, layout.focusedPaneId, direction);
        if (next === null) return;
        event.preventDefault();
        setLayout(focusPane(layout, next));
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      if (event.key === '\\') {
        const surface = availableSurfaces(layout)[0];
        if (surface === undefined) return;
        event.preventDefault();
        const target = narrow ? leaves(layout)[0]!.id : layout.focusedPaneId;
        const next = splitLeaf(layout, target, 'right', surface);
        if (next === layout) return;
        setLayout(next);
        if (narrow) setNarrowTab(surface);
        return;
      }

      if (event.key.toLowerCase() === 'w' && !event.shiftKey) {
        if (narrow || leafCount(layout.root) <= 1) return;
        event.preventDefault();
        const next = closeLeaf(layout, layout.focusedPaneId);
        if (next !== layout) setLayout(next);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layout, narrow]);

  return (
    <div
      ref={containerRef}
      data-testid="pane-workspace"
      data-narrow={narrow ? 'true' : 'false'}
      data-pane-count={leafCount(layout.root)}
      data-focused-pane={layout.focusedPaneId}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <SplitView
        node={root}
        grow={{ flexGrow: 1, flexBasis: 0 }}
        threadId={threadId}
        thread={thread}
        projectName={projectName}
        narrow={narrow}
        focusedPaneId={focusedPaneId}
        openPaneSurfaces={openPaneSurfaces}
        canSplit={canSplit}
        dragKind={dragKind}
        dropTarget={dropTarget}
        threadStageRef={threadStageRef}
        externalSubagentPane={externalSubagentPane}
        actions={{
          focus,
          selectSurface,
          closeSurface,
          addSurface,
          splitSurface,
          closePane,
          openInTerminal,
          closeSubagent,
          dragStart,
          leafDragOver,
          leafDragLeave,
          leafDrop,
          beginResize,
          moveResize,
          endResize,
          nudgeSplit,
          resetSplit: (splitId) => setLayout(resetSplit(layout, splitId)),
        }}
      />
    </div>
  );
}

const ARROW_DIRECTION: Record<string, PaneDirection | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

interface PaneActions {
  focus(paneId: string): void;
  selectSurface(paneId: string, surface: PaneSurface): void;
  closeSurface(paneId: string, surface: PaneSurface): void;
  addSurface(paneId: string, surface: PaneSurface): void;
  splitSurface(paneId: string, surface: PaneSurface): void;
  closePane(paneId: string): void;
  openInTerminal(paneId: string, path: string): void;
  closeSubagent(): void;
  dragStart(event: DragEvent<HTMLElement>, payload: DragPayload): void;
  leafDragOver(event: DragEvent<HTMLElement>, paneId: string): void;
  leafDragLeave(event: DragEvent<HTMLElement>, paneId: string): void;
  leafDrop(event: DragEvent<HTMLElement>, paneId: string): void;
  beginResize(event: ReactPointerEvent<HTMLDivElement>, split: PaneSplit): void;
  moveResize(event: ReactPointerEvent<HTMLDivElement>, splitId: string): void;
  endResize(event: ReactPointerEvent<HTMLDivElement>, splitId: string): void;
  nudgeSplit(event: ReactKeyboardEvent<HTMLDivElement>, split: PaneSplit, step: number): void;
  resetSplit(splitId: string): void;
}

interface SplitViewProps {
  node: PaneNode;
  grow: CSSProperties;
  threadId: string;
  thread?: Thread;
  projectName?: string;
  narrow: boolean;
  focusedPaneId: string;
  openPaneSurfaces: readonly PaneSurface[];
  canSplit: boolean;
  dragKind: DragKind | null;
  dropTarget: DropTarget | null;
  threadStageRef: RefObject<HTMLDivElement | null>;
  externalSubagentPane: boolean;
  actions: PaneActions;
}

/** One split or one leaf: horizontal splits are rows, vertical splits columns. */
function SplitView(props: SplitViewProps) {
  const { node, grow, narrow, focusedPaneId, dragKind, dropTarget, actions } = props;

  if (node.kind === 'leaf') {
    return (
      <LeafPane
        {...props}
        pane={node.pane}
        focused={narrow ? true : node.pane.id === focusedPaneId}
        dragging={dragKind !== null}
        dropTarget={dropTarget !== null && dropTarget.paneId === node.pane.id ? dropTarget : null}
      />
    );
  }

  const horizontal = node.orientation === 'horizontal';
  return (
    <div
      style={grow}
      data-split-id={node.id}
      data-split-orientation={node.orientation}
      className={cn('flex min-h-0 min-w-0 overflow-hidden', horizontal ? 'flex-row' : 'flex-col')}
    >
      <SplitView {...props} node={node.children[0]} grow={{ flexGrow: node.sizes[0], flexBasis: 0 }} />
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={horizontal ? 'Resize panes side by side' : 'Resize panes stacked'}
        aria-valuenow={Math.round(node.sizes[0])}
        tabIndex={0}
        data-testid="pane-splitter"
        data-split-id={node.id}
        data-split-orientation={node.orientation}
        className={cn(
          'group relative z-10 shrink-0 touch-none bg-border select-none transition-colors duration-150 ease-out outline-none hover:bg-primary/50 focus-visible:bg-primary/40',
          horizontal ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        )}
        onPointerDown={(event) => actions.beginResize(event, node)}
        onPointerMove={(event) => actions.moveResize(event, node.id)}
        onPointerUp={(event) => actions.endResize(event, node.id)}
        onPointerCancel={(event) => actions.endResize(event, node.id)}
        onDoubleClick={() => actions.resetSplit(node.id)}
        onKeyDown={(event) => {
          const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
          const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
          if (event.key !== forward && event.key !== back) return;
          event.preventDefault();
          actions.nudgeSplit(event, node, event.shiftKey ? 48 : 16);
        }}
      />
      <SplitView {...props} node={node.children[1]} grow={{ flexGrow: node.sizes[1], flexBasis: 0 }} />
    </div>
  );
}

interface LeafPaneProps extends SplitViewProps {
  pane: PaneLayoutPane;
  focused: boolean;
  dragging: boolean;
  dropTarget: DropTarget | null;
}

/** One tile: its header, its mounted surfaces, and its drop zones. */
function LeafPane({
  pane,
  grow,
  threadId,
  thread,
  projectName,
  narrow,
  focused,
  dragging,
  dropTarget,
  openPaneSurfaces,
  canSplit,
  threadStageRef,
  externalSubagentPane,
  actions,
}: LeafPaneProps) {
  const movable = !pane.tabs.includes('thread');

  return (
    <section
      aria-label={`Pane ${pane.id}`}
      data-testid={`pane-leaf-${pane.id}`}
      data-pane-id={pane.id}
      data-surface={pane.activeTab}
      data-focused={focused ? 'true' : undefined}
      data-drop-zone={dropTarget?.zone}
      style={{ ...grow, minWidth: narrow ? undefined : MIN_PANE_WIDTH_PX }}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col overflow-hidden',
        focused && !narrow ? 'ring-1 ring-primary/25 ring-inset' : null,
      )}
      onPointerDown={() => actions.focus(pane.id)}
      onDragEnter={(event) => actions.leafDragOver(event, pane.id)}
      onDragOver={(event) => actions.leafDragOver(event, pane.id)}
      onDragLeave={(event) => actions.leafDragLeave(event, pane.id)}
      onDrop={(event) => actions.leafDrop(event, pane.id)}
    >
      <PaneHeader
        pane={pane}
        canClosePane={movable && !narrow}
        canSplit={canSplit && !narrow}
        openSurfaces={openPaneSurfaces}
        dropIndex={dropTarget !== null && dropTarget.zone === 'center' ? dropTarget.index : null}
        onSelect={(surface) => actions.selectSurface(pane.id, surface)}
        onCloseTab={(surface) => actions.closeSurface(pane.id, surface)}
        onAddTab={(surface) => actions.addSurface(pane.id, surface)}
        onSplit={(surface) => actions.splitSurface(pane.id, surface)}
        onClosePane={() => actions.closePane(pane.id)}
        onDragStart={actions.dragStart}
        paneId={pane.id}
        movable={movable}
      />
      <PaneBody
        pane={pane}
        threadId={threadId}
        thread={thread}
        projectName={projectName}
        threadStageRef={threadStageRef}
        externalSubagentPane={externalSubagentPane}
        onOpenInTerminal={(path) => actions.openInTerminal(pane.id, path)}
        onCloseSubagent={actions.closeSubagent}
      />
      <DropZones
        active={dragging}
        zone={dropTarget?.zone ?? null}
        disabled={!canSplit}
        paneId={pane.id}
      />
    </section>
  );
}

interface DropZonesProps {
  active: boolean;
  zone: PaneDropZone | null;
  disabled: boolean;
  paneId: string;
}

/**
 * The five drop targets over a leaf. They are markers for the drag, not hit
 * targets: the leaf itself reads the pointer position, so a drop never depends
 * on a zone that appeared mid-drag.
 */
function DropZones({ active, zone, disabled, paneId }: DropZonesProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="pane-drop-zones"
      data-drag-active={active ? 'true' : 'false'}
      className={cn(
        'pointer-events-none absolute inset-0 z-20',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      {(Object.keys(ZONE_CLASS) as PaneDropZone[]).map((id) => (
        <div
          key={id}
          data-testid={`pane-drop-zone-${id}`}
          data-pane-id={paneId}
          data-zone={id}
          data-active={zone === id ? 'true' : undefined}
          data-disabled={disabled && id !== 'center' ? 'true' : undefined}
          className={cn(
            'absolute rounded-sm border border-transparent transition-colors duration-100',
            ZONE_CLASS[id],
            zone === id
              ? disabled && id !== 'center'
                ? 'border-destructive/40 bg-destructive/15'
                : 'border-primary/40 bg-primary/15'
              : 'bg-transparent',
          )}
        />
      ))}
    </div>
  );
}

interface PaneHeaderProps {
  pane: PaneLayoutPane;
  paneId: string;
  movable: boolean;
  canClosePane: boolean;
  canSplit: boolean;
  openSurfaces: readonly PaneSurface[];
  dropIndex: number | null;
  onSelect(surface: PaneSurface): void;
  onCloseTab(surface: PaneSurface): void;
  onAddTab(surface: PaneSurface): void;
  onSplit(surface: PaneSurface): void;
  onClosePane(): void;
  onDragStart(event: DragEvent<HTMLElement>, payload: DragPayload): void;
}

/**
 * Pane header: the drag handle, the surface tabs with the drop indicator, the
 * add-tab and split menus, and the close-pane control. The leaf that hosts the
 * thread has no close button and its drag handle is inert.
 */
function PaneHeader({
  pane,
  paneId,
  movable,
  canClosePane,
  canSplit,
  openSurfaces,
  dropIndex,
  onSelect,
  onCloseTab,
  onAddTab,
  onSplit,
  onClosePane,
  onDragStart,
}: PaneHeaderProps) {
  const threads = useAppStore((state) => state.threads);
  const titleOf = (id: string): string | undefined => threads[id]?.title;
  const activeLabel = paneSurfaceLabel(pane.activeTab, titleOf);

  return (
    <div
      data-testid="pane-header"
      data-pane-id={paneId}
      data-drop-target={dropIndex !== null ? 'true' : undefined}
      className={cn(
        'relative flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background pr-1 pl-1.5',
        dropIndex !== null ? 'bg-primary/5 ring-1 ring-primary/40 ring-inset' : null,
      )}
    >
      <span
        draggable={movable}
        onDragStart={(event) => onDragStart(event, { kind: 'leaf', paneId })}
        title={
          movable
            ? `Drag ${activeLabel} and all its tabs to another tile`
            : 'The thread tile stays in place'
        }
        data-testid="pane-drag-handle"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50',
          movable ? 'cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing' : null,
        )}
      >
        <GripVertical aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      </span>

      <div
        role="tablist"
        aria-label={`Pane ${paneId} surfaces`}
        data-pane-tab-strip
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {pane.tabs.map((surface, index) => {
          const Icon = paneSurfaceIcon(surface);
          const label = paneSurfaceLabel(surface, titleOf);
          const active = surface === pane.activeTab;
          return (
            <Fragment key={surface}>
              {dropIndex === index ? <DropIndicator /> : null}
              <div
                data-testid="pane-tab"
                data-surface={surface}
                data-active={active ? 'true' : 'false'}
                draggable={surface !== 'thread'}
                onDragStart={(event) => onDragStart(event, { kind: 'tab', paneId, surface })}
                className={cn(
                  'flex h-6 shrink-0 items-center rounded-sm transition-colors duration-150 ease-out',
                  active
                    ? 'bg-surface-raised text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid="pane-tab-button"
                  onClick={() => onSelect(surface)}
                  className={cn(
                    'flex h-full min-w-0 items-center gap-1 rounded-sm pr-1 pl-2 text-2xs font-medium',
                    focusRing,
                  )}
                >
                  <Icon aria-hidden="true" strokeWidth={1.75} className="size-3 shrink-0" />
                  <span className="max-w-24 truncate">{label}</span>
                </button>
                {surface === 'thread' ? null : (
                  <button
                    type="button"
                    aria-label={`Close ${label}`}
                    data-testid="pane-tab-close"
                    onClick={() => onCloseTab(surface)}
                    className={cn(
                      'mr-0.5 flex size-4 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground',
                      focusRing,
                    )}
                  >
                    <X aria-hidden="true" strokeWidth={1.75} className="size-3" />
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}
        {dropIndex !== null && dropIndex >= pane.tabs.length ? <DropIndicator /> : null}
      </div>

      <PaneSurfaceMenu
        testId="pane-add-tab"
        itemTestId="pane-add-surface"
        label="Open a surface in this pane"
        icon={Plus}
        surfaces={openSurfaces}
        onPick={onAddTab}
      />
      <PaneSurfaceMenu
        testId="pane-split"
        itemTestId="pane-split-surface"
        label="Split pane"
        icon={Columns2}
        surfaces={canSplit ? openSurfaces : []}
        onPick={onSplit}
        disabled={!canSplit}
      />
      {canClosePane ? (
        <IconButton
          icon={X}
          label="Close pane"
          size="sm"
          data-testid="pane-close"
          className="shrink-0"
          onClick={onClosePane}
        />
      ) : null}
    </div>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden="true"
      data-testid="pane-drop-indicator"
      className="h-4 w-0.5 shrink-0 rounded-full bg-primary"
    />
  );
}

interface PaneSurfaceMenuProps {
  testId: string;
  itemTestId: string;
  label: string;
  icon: LucideIcon;
  surfaces: readonly PaneSurface[];
  onPick(surface: PaneSurface): void;
  disabled?: boolean;
}

function PaneSurfaceMenu({
  testId,
  itemTestId,
  label,
  icon: Icon,
  surfaces,
  onPick,
  disabled = false,
}: PaneSurfaceMenuProps) {
  return (
    <PopoverRoot>
      <PopoverTrigger
        data-testid={testId}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0')}
      >
        <Icon strokeWidth={1.75} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-48 p-1">
        {surfaces.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">Every surface is open.</p>
        ) : (
          surfaces.map((surface) => {
            const SurfaceIcon = paneSurfaceIcon(surface);
            return (
              <PopoverClose
                key={surface}
                data-testid={`${itemTestId}-${surface}`}
                onClick={() => onPick(surface)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent',
                  focusRing,
                )}
              >
                <SurfaceIcon
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3.5 text-muted-foreground"
                />
                {paneSurfaceLabel(surface)}
              </PopoverClose>
            );
          })
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

interface PaneBodyProps {
  pane: PaneLayoutPane;
  threadId: string;
  thread?: Thread;
  projectName?: string;
  threadStageRef: RefObject<HTMLDivElement | null>;
  externalSubagentPane: boolean;
  onOpenInTerminal(path: string): void;
  onCloseSubagent(): void;
}

/**
 * Keeps every visited surface mounted so switching tabs does not close a
 * terminal or drop a diff comment. The thread surface stays mounted from the
 * start: it owns the stream subscription and the composer.
 */
function PaneBody({
  pane,
  threadId,
  thread,
  projectName,
  threadStageRef,
  externalSubagentPane,
  onOpenInTerminal,
  onCloseSubagent,
}: PaneBodyProps) {
  const [mounted, setMounted] = useState<PaneSurface[]>(() =>
    pane.tabs.includes('thread')
      ? ['thread', ...(pane.activeTab === 'thread' ? [] : [pane.activeTab])]
      : [pane.activeTab],
  );

  useEffect(() => {
    setMounted((current) =>
      current.includes(pane.activeTab) ? current : [...current, pane.activeTab],
    );
  }, [pane.activeTab]);

  const surfaces = mounted.filter((surface) => pane.tabs.includes(surface));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {surfaces.map((surface) => {
        const active = surface === pane.activeTab;
        return (
          <div
            key={surface}
            role="tabpanel"
            aria-label={paneSurfaceLabel(surface)}
            data-testid="pane-surface"
            data-surface={surface}
            data-active={active ? 'true' : 'false'}
            style={{ display: active ? 'flex' : 'none' }}
            className="min-h-0 flex-1 flex-col"
          >
            <PaneSurfaceView
              surface={surface}
              threadId={threadId}
              thread={thread}
              projectName={projectName}
              threadStageRef={threadStageRef}
              externalSubagentPane={externalSubagentPane}
              onOpenInTerminal={onOpenInTerminal}
              onCloseSubagent={onCloseSubagent}
            />
          </div>
        );
      })}
    </div>
  );
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/** The drop zone a pointer is over: a 25 percent edge band, else the center. */
function zoneAt(leaf: HTMLElement, clientX: number, clientY: number): PaneDropZone {
  const box = leaf.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return 'center';
  const x = (clientX - box.left) / box.width;
  const y = (clientY - box.top) / box.height;
  if (x < DROP_EDGE_RATIO) return 'left';
  if (x > 1 - DROP_EDGE_RATIO) return 'right';
  if (y < DROP_EDGE_RATIO) return 'top';
  if (y > 1 - DROP_EDGE_RATIO) return 'bottom';
  return 'center';
}

/** The insertion point among the target header's tabs, in tab order. */
function dropIndexAt(leaf: HTMLElement, clientX: number): number {
  const header = leaf.querySelector<HTMLElement>('[data-testid="pane-header"]');
  if (header === null) return -1;
  const tabs = [...header.querySelectorAll<HTMLElement>('[data-pane-tab]')];
  let index = 0;
  for (const tab of tabs) {
    const box = tab.getBoundingClientRect();
    if (clientX > box.left + box.width / 2) index += 1;
  }
  return index;
}

function dragKindOf(transfer: DataTransfer | null): DragKind | null {
  if (transfer === null) return null;
  const types = [...transfer.types];
  if (types.includes(PANE_LEAF_MIME)) return 'leaf';
  if (types.includes(PANE_TAB_MIME)) return 'tab';
  if (types.includes(THREAD_DRAG_MIME)) return 'thread';
  return null;
}

function readPayload(transfer: DataTransfer | null): DragPayload | null {
  if (transfer === null) return null;

  const leaf = transfer.getData(PANE_LEAF_MIME);
  if (leaf.length > 0) {
    try {
      const parsed: unknown = JSON.parse(leaf);
      if (typeof parsed === 'object' && parsed !== null && 'paneId' in parsed) {
        const paneId = parsed.paneId;
        if (typeof paneId === 'string') return { kind: 'leaf', paneId };
      }
    } catch {
      return null;
    }
  }

  const tab = transfer.getData(PANE_TAB_MIME);
  if (tab.length > 0) {
    try {
      const parsed: unknown = JSON.parse(tab);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'paneId' in parsed &&
        'surface' in parsed &&
        typeof parsed.paneId === 'string' &&
        isPaneSurface(parsed.surface)
      ) {
        return { kind: 'tab', paneId: parsed.paneId, surface: parsed.surface };
      }
    } catch {
      return null;
    }
  }

  const threadId = transfer.getData(THREAD_DRAG_MIME);
  if (threadId.length > 0) return { kind: 'thread', threadId };
  return null;
}

/** The collapsed narrow leaf keeps whichever tab the user last picked. */
function withActiveTab(node: PaneNode, surface: PaneSurface | null): PaneNode {
  if (surface === null || node.kind !== 'leaf') return node;
  if (!node.pane.tabs.includes(surface) || node.pane.activeTab === surface) return node;
  return leafNode({ ...node.pane, activeTab: surface });
}

/** Ctrl+W, Ctrl+\ and Alt+Arrow belong to the shell and to text fields, not the row. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-terminal-id], .xterm')) return true;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [role="textbox"]') !== null;
}
