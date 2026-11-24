/** Matches the default `fontSize` of the ui Terminal wrapper. */
export const TERMINAL_FONT_SIZE = 13;

/** Fallback when the panel has not been laid out yet (hidden route, first paint). */
export const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 } as const;

export interface TerminalSize {
  cols: number;
  rows: number;
}

function monoFontFamily(): string {
  if (typeof document === 'undefined') return 'monospace';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return value.length > 0 ? value : 'monospace';
}

function measureCharWidth(fontSize: number): number | null {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  context.font = `${fontSize}px ${monoFontFamily()}`;
  const width = context.measureText('MMMMMMMMMM').width / 10;
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * Estimate the pty size from the panel body so `terminal.open` starts at the
 * right shape. xterm refits on mount and reports the exact size straight after.
 */
export function measureTerminalSize(
  container: HTMLElement | null,
  fontSize = TERMINAL_FONT_SIZE,
): TerminalSize {
  if (!container) return { ...DEFAULT_TERMINAL_SIZE };

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return { ...DEFAULT_TERMINAL_SIZE };

  const charWidth = measureCharWidth(fontSize) ?? fontSize * 0.6;
  const lineHeight = fontSize * 1.25;

  return {
    cols: Math.max(1, Math.floor(width / charWidth)),
    rows: Math.max(1, Math.floor(height / lineHeight)),
  };
}
