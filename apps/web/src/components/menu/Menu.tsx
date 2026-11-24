import { Kbd, cn } from '@tuffcode/ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ACTIONS,
  actionUnavailableReason,
  runAction,
  type ActionContext,
  type ActionId,
} from '../actions';
import {
  MENU_MIN_WIDTH_PX,
  MENU_PADDING_PX,
  MENU_RADIUS_PX,
  MENU_ROW_FONT_SIZE_PX,
  MENU_ROW_HEIGHT_PX,
  clampMenuPosition,
  firstEnabledIndex,
  menuKeyResult,
  menuSize,
  type MenuPoint,
} from './menu-model';

export interface MenuOpenRequest {
  point: MenuPoint;
  items: readonly ActionId[];
  context: ActionContext;
  /** Accessible name, e.g. "Thread actions". */
  label?: string;
  /** Focused element to return to when the menu closes. */
  restoreFocus?: HTMLElement | null;
}

interface MenuApi {
  open(request: MenuOpenRequest): void;
  close(): void;
}

interface OpenMenuState extends MenuOpenRequest {
  key: number;
  restoreFocus: HTMLElement | null;
}

const MenuContext = createContext<MenuApi | null>(null);

export function useMenu(): MenuApi {
  const api = useContext(MenuContext);
  if (api === null) throw new Error('useMenu must be used inside MenuProvider.');
  return api;
}

/**
 * One menu instance for the whole window. Opening a menu replaces whatever was
 * open, so two surfaces can never both claim the Escape key.
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenMenuState | null>(null);
  const sequence = useRef(0);

  const close = useCallback(() => setState(null), []);

  const open = useCallback((request: MenuOpenRequest) => {
    sequence.current += 1;
    setState({
      ...request,
      key: sequence.current,
      restoreFocus: request.restoreFocus ?? null,
    });
  }, []);

  const api = useMemo<MenuApi>(() => ({ open, close }), [close, open]);

  return (
    <MenuContext.Provider value={api}>
      {children}
      {state === null ? null : <MenuPopup key={state.key} state={state} onClose={close} />}
    </MenuContext.Provider>
  );
}

function MenuPopup({ state, onClose }: { state: OpenMenuState; onClose: () => void }) {
  const disabled = state.items.map((id) => actionUnavailableReason(id, state.context) !== null);
  const [activeIndex, setActiveIndex] = useState(() => firstEnabledIndex(disabled));
  const menuRef = useRef<HTMLDivElement>(null);
  const [position] = useState(() =>
    clampMenuPosition(
      state.point,
      { width: window.innerWidth, height: window.innerHeight },
      menuSize(state.items.length),
    ),
  );

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const restore = state.restoreFocus;
    return () => {
      if (restore?.isConnected) restore.focus();
    };
  }, [state.restoreFocus]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const menu = menuRef.current;
      if (menu !== null && event.target instanceof Node && menu.contains(event.target)) return;
      onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  function activate(id: ActionId): void {
    const context = state.context;
    onClose();
    void Promise.resolve(runAction(id, context)).catch((error: unknown) => {
      context.notify.error(error instanceof Error ? error.message : 'That action failed.');
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const result = menuKeyResult(event.key, activeIndex, disabled);
    if (result.type === 'none') return;
    event.preventDefault();
    event.stopPropagation();

    if (result.type === 'close') {
      onClose();
      return;
    }
    if (result.type === 'move') {
      if (result.index >= 0) setActiveIndex(result.index);
      return;
    }
    const id = state.items[result.index];
    if (id !== undefined) activate(id);
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={state.label ?? 'Actions'}
      aria-activedescendant={
        activeIndex >= 0 && state.items[activeIndex] !== undefined
          ? `menu-item-${state.items[activeIndex]}`
          : undefined
      }
      tabIndex={-1}
      data-testid="context-menu"
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        left: position.x,
        top: position.y,
        minWidth: MENU_MIN_WIDTH_PX,
        borderRadius: MENU_RADIUS_PX,
        padding: MENU_PADDING_PX,
        fontSize: MENU_ROW_FONT_SIZE_PX,
      }}
      className={cn(
        'fixed z-[60] flex flex-col border border-border bg-popover text-popover-foreground',
        'shadow-xl outline-none',
      )}
    >
      {state.items.map((id, index) => {
        const action = ACTIONS[id];
        const reason = actionUnavailableReason(id, state.context);
        const Icon = action.icon;
        const active = index === activeIndex;

        return (
          <button
            key={id}
            id={`menu-item-${id}`}
            type="button"
            role="menuitem"
            data-action={id}
            data-active={active}
            data-destructive={action.destructive === true}
            disabled={reason !== null}
            title={reason ?? action.label}
            style={{ height: MENU_ROW_HEIGHT_PX }}
            onMouseEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            onClick={() => {
              if (reason === null) activate(id);
            }}
            className={cn(
              'flex w-full shrink-0 items-center gap-2 rounded-sm px-2 text-left',
              'outline-none transition-colors duration-100 ease-out',
              'disabled:cursor-not-allowed disabled:opacity-50',
              action.destructive
                ? 'text-error-foreground data-[active=true]:bg-error-surface'
                : 'text-foreground data-[active=true]:bg-accent',
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
            {action.shortcut === undefined ? null : (
              <Kbd className="h-4 min-w-0 shrink-0 border-0 bg-transparent px-0 text-2xs text-muted-foreground">
                {action.shortcut}
              </Kbd>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Right-click and the keyboard menu key (Shift+F10 or the Menu key) for one
 * element. Spread the result onto the element that owns the actions.
 */
export function useContextMenuTrigger(
  items: readonly ActionId[],
  context: ActionContext,
  options?: { label?: string },
) {
  const menu = useMenu();
  const itemsRef = useRef(items);
  const contextRef = useRef(context);
  const labelRef = useRef(options?.label);
  itemsRef.current = items;
  contextRef.current = context;
  labelRef.current = options?.label;

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      menu.open({
        point: { x: event.clientX, y: event.clientY },
        items: itemsRef.current,
        context: contextRef.current,
        label: labelRef.current,
        restoreFocus: event.currentTarget,
      });
    },
    [menu],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const opensMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
      if (!opensMenu) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      menu.open({
        point: { x: rect.left + 8, y: rect.bottom + 2 },
        items: itemsRef.current,
        context: contextRef.current,
        label: labelRef.current,
        restoreFocus: event.currentTarget,
      });
    },
    [menu],
  );

  return { onContextMenu, onKeyDown };
}
