import { describe, expect, it } from 'vitest';
import {
  MENU_MIN_WIDTH_PX,
  MENU_RADIUS_PX,
  MENU_ROW_FONT_SIZE_PX,
  MENU_ROW_HEIGHT_PX,
  MENU_VIEWPORT_MARGIN_PX,
  clampMenuPosition,
  firstEnabledIndex,
  lastEnabledIndex,
  matchesMenuQuery,
  menuKeyResult,
  menuSize,
  stepEnabledIndex,
} from './menu-model';

describe('menu geometry', () => {
  it('is 220px wide, 8px radius and 13px type', () => {
    expect(MENU_MIN_WIDTH_PX).toBe(220);
    expect(MENU_RADIUS_PX).toBe(8);
    expect(MENU_ROW_FONT_SIZE_PX).toBe(13);
  });

  it('sizes the box from its row count', () => {
    expect(menuSize(4).width).toBe(220);
    expect(menuSize(4).height).toBeGreaterThan(4 * MENU_ROW_HEIGHT_PX);
    expect(menuSize(0).height).toBeGreaterThan(0);
  });

  it('keeps a click near the bottom-right inside the viewport', () => {
    const viewport = { width: 800, height: 600 };
    const size = menuSize(6);
    const clamped = clampMenuPosition({ x: 790, y: 590 }, viewport, size);

    expect(clamped.x).toBe(viewport.width - size.width - MENU_VIEWPORT_MARGIN_PX);
    expect(clamped.y).toBe(viewport.height - size.height - MENU_VIEWPORT_MARGIN_PX);
  });

  it('keeps a click near the top-left at the margin', () => {
    const clamped = clampMenuPosition({ x: -20, y: 0 }, { width: 800, height: 600 }, menuSize(2));
    expect(clamped).toEqual({ x: MENU_VIEWPORT_MARGIN_PX, y: MENU_VIEWPORT_MARGIN_PX });
  });

  it('does not push a menu larger than the viewport off the top', () => {
    const clamped = clampMenuPosition({ x: 100, y: 100 }, { width: 200, height: 100 }, menuSize(8));
    expect(clamped.x).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN_PX);
    expect(clamped.y).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN_PX);
  });
});

describe('menu keyboard navigation', () => {
  it('finds the first and last enabled rows', () => {
    const disabled = [true, false, true, false, true];
    expect(firstEnabledIndex(disabled)).toBe(1);
    expect(lastEnabledIndex(disabled)).toBe(3);
  });

  it('reports -1 when every row is disabled', () => {
    const disabled = [true, true];
    expect(firstEnabledIndex(disabled)).toBe(-1);
    expect(lastEnabledIndex(disabled)).toBe(-1);
    expect(stepEnabledIndex(disabled, 0, 1)).toBe(-1);
  });

  it('wraps down and up, skipping disabled rows', () => {
    const disabled = [false, true, false, false];
    expect(stepEnabledIndex(disabled, 0, 1)).toBe(2);
    expect(stepEnabledIndex(disabled, 3, 1)).toBe(0);
    expect(stepEnabledIndex(disabled, 0, -1)).toBe(3);
    expect(stepEnabledIndex(disabled, 2, -1)).toBe(0);
  });

  it('moves with arrows, Home and End', () => {
    const disabled = [false, true, false];
    expect(menuKeyResult('ArrowDown', 0, disabled)).toEqual({ type: 'move', index: 2 });
    expect(menuKeyResult('ArrowUp', 0, disabled)).toEqual({ type: 'move', index: 2 });
    expect(menuKeyResult('Home', 2, disabled)).toEqual({ type: 'move', index: 0 });
    expect(menuKeyResult('End', 0, disabled)).toEqual({ type: 'move', index: 2 });
  });

  it('activates with Enter and Space only on an enabled row', () => {
    const disabled = [false, true];
    expect(menuKeyResult('Enter', 0, disabled)).toEqual({ type: 'activate', index: 0 });
    expect(menuKeyResult(' ', 0, disabled)).toEqual({ type: 'activate', index: 0 });
    expect(menuKeyResult('Enter', 1, disabled)).toEqual({ type: 'none' });
  });

  it('closes on Escape and Tab', () => {
    expect(menuKeyResult('Escape', 0, [false])).toEqual({ type: 'close' });
    expect(menuKeyResult('Tab', 0, [false])).toEqual({ type: 'close' });
  });

  it('ignores keys that are not menu keys', () => {
    expect(menuKeyResult('a', 0, [false])).toEqual({ type: 'none' });
    expect(menuKeyResult('ArrowLeft', 0, [false])).toEqual({ type: 'none' });
  });
});

describe('palette filtering', () => {
  it('matches case-insensitively and ignores padding', () => {
    expect(matchesMenuQuery('Copy path', 'copy')).toBe(true);
    expect(matchesMenuQuery('Copy path', '  PATH ')).toBe(true);
    expect(matchesMenuQuery('Copy path', 'delete')).toBe(false);
    expect(matchesMenuQuery('Copy path', '   ')).toBe(true);
  });
});
