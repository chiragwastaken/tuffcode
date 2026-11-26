import { describe, expect, it } from 'vitest';
import {
  TERMINAL_CURSOR_STYLE,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK,
  terminalOptions,
} from './terminal-options';

describe('terminalOptions', () => {
  it('keeps the wrapper defaults when nothing is stored yet', () => {
    expect(terminalOptions()).toEqual({
      scrollback: TERMINAL_SCROLLBACK,
      fontSize: TERMINAL_FONT_SIZE,
      cursorStyle: TERMINAL_CURSOR_STYLE,
      cursorBlink: true,
    });
  });

  it('maps stored scrollback and font size straight onto the xterm options', () => {
    expect(terminalOptions({ scrollback: 25000, fontSize: 17 })).toEqual({
      scrollback: 25000,
      fontSize: 17,
      cursorStyle: 'bar',
      cursorBlink: true,
    });
  });

  it('keeps a zero scrollback, which is a real choice and not a missing value', () => {
    expect(terminalOptions({ scrollback: 0 }).scrollback).toBe(0);
  });

  it('falls back instead of handing xterm a value it cannot use', () => {
    expect(terminalOptions({ scrollback: -1, fontSize: 0 })).toEqual({
      scrollback: TERMINAL_SCROLLBACK,
      fontSize: TERMINAL_FONT_SIZE,
      cursorStyle: 'bar',
      cursorBlink: true,
    });
    expect(terminalOptions({ fontSize: Number.NaN }).fontSize).toBe(TERMINAL_FONT_SIZE);
    expect(terminalOptions({ scrollback: 12.7 }).scrollback).toBe(12);
  });

  it.each([
    ['block', false],
    ['bar', true],
    ['underline', true],
  ] as const)('derives the cursor blink from a %s cursor', (cursorStyle, cursorBlink) => {
    expect(terminalOptions({ cursorStyle })).toMatchObject({ cursorStyle, cursorBlink });
  });
});
