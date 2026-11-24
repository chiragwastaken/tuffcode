/**
 * Pure geometry and keyboard rules for the in-app menu. Kept out of the
 * component so the navigation contract is testable without a DOM.
 */

export const MENU_MIN_WIDTH_PX = 220;
export const MENU_RADIUS_PX = 8;
/** Row text size; the menu is 13px type in 28px rows. */
export const MENU_ROW_FONT_SIZE_PX = 13;
export const MENU_ROW_HEIGHT_PX = 28;
export const MENU_PADDING_PX = 4;
export const MENU_VIEWPORT_MARGIN_PX = 4;

export interface MenuPoint {
  x: number;
  y: number;
}

export interface MenuViewport {
  width: number;
  height: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export function menuSize(itemCount: number): MenuSize {
  return {
    width: MENU_MIN_WIDTH_PX,
    height: Math.max(1, itemCount) * MENU_ROW_HEIGHT_PX + MENU_PADDING_PX * 2,
  };
}

/** Keeps the whole menu inside the viewport, even for a click near an edge. */
export function clampMenuPosition(
  point: MenuPoint,
  viewport: MenuViewport,
  size: MenuSize,
): MenuPoint {
  const maxX = Math.max(
    MENU_VIEWPORT_MARGIN_PX,
    viewport.width - size.width - MENU_VIEWPORT_MARGIN_PX,
  );
  const maxY = Math.max(
    MENU_VIEWPORT_MARGIN_PX,
    viewport.height - size.height - MENU_VIEWPORT_MARGIN_PX,
  );
  return {
    x: Math.min(Math.max(MENU_VIEWPORT_MARGIN_PX, point.x), maxX),
    y: Math.min(Math.max(MENU_VIEWPORT_MARGIN_PX, point.y), maxY),
  };
}

export function firstEnabledIndex(disabled: readonly boolean[]): number {
  return disabled.findIndex((value) => !value);
}

export function lastEnabledIndex(disabled: readonly boolean[]): number {
  for (let index = disabled.length - 1; index >= 0; index -= 1) {
    if (!disabled[index]) return index;
  }
  return -1;
}

/** Moves one enabled row, wrapping at both ends. -1 when every row is disabled. */
export function stepEnabledIndex(
  disabled: readonly boolean[],
  from: number,
  delta: 1 | -1,
): number {
  const count = disabled.length;
  if (count === 0) return -1;
  let index = from;
  for (let step = 0; step < count; step += 1) {
    index = (index + delta + count) % count;
    if (!disabled[index]) return index;
  }
  return -1;
}

export type MenuKeyResult =
  | { type: 'move'; index: number }
  | { type: 'activate'; index: number }
  | { type: 'close' }
  | { type: 'none' };

/** The menu's whole keyboard contract: arrows, Home/End, Enter/Space, Escape, Tab. */
export function menuKeyResult(
  key: string,
  activeIndex: number,
  disabled: readonly boolean[],
): MenuKeyResult {
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: stepEnabledIndex(disabled, activeIndex, 1) };
    case 'ArrowUp':
      return { type: 'move', index: stepEnabledIndex(disabled, activeIndex, -1) };
    case 'Home':
      return { type: 'move', index: firstEnabledIndex(disabled) };
    case 'End':
      return { type: 'move', index: lastEnabledIndex(disabled) };
    case 'Enter':
    case ' ':
      return disabled[activeIndex] ? { type: 'none' } : { type: 'activate', index: activeIndex };
    case 'Escape':
    case 'Tab':
      return { type: 'close' };
    default:
      return { type: 'none' };
  }
}

/** Case-insensitive label filter shared by the command palette. */
export function matchesMenuQuery(label: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || label.toLowerCase().includes(needle);
}
