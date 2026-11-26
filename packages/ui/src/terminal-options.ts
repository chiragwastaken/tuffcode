/**
 * The pure half of the terminal wrapper: stored settings in, xterm options out. It lives
 * apart from the component so the mapping is testable without a DOM or an xterm instance.
 */

export type TerminalCursorStyle = 'block' | 'bar' | 'underline';

/** Appearance settings; every field falls back to the default below. */
export interface TerminalAppearance {
  scrollback?: number;
  fontSize?: number;
  cursorStyle?: TerminalCursorStyle;
}

/** The xterm options one appearance maps to. */
export interface TerminalOptions {
  scrollback: number;
  fontSize: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}

/** What the wrapper used before these were settings, and what an omitted field keeps. */
export const TERMINAL_SCROLLBACK = 5000;
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'bar';

/** Zero scrollback is a real choice, so only a negative or unusable value falls back. */
function scrollbackLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return TERMINAL_SCROLLBACK;
  return Math.floor(value);
}

function fontPixels(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return TERMINAL_FONT_SIZE;
  return Math.floor(value);
}

/**
 * A block cursor is already easy to find, so it stays solid; bar and underline carets are
 * a single line and blink so they do not disappear against the text.
 */
export function terminalOptions(appearance: TerminalAppearance = {}): TerminalOptions {
  const cursorStyle = appearance.cursorStyle ?? TERMINAL_CURSOR_STYLE;
  return {
    scrollback: scrollbackLines(appearance.scrollback),
    fontSize: fontPixels(appearance.fontSize),
    cursorStyle,
    cursorBlink: cursorStyle !== 'block',
  };
}
