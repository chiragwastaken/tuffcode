import { THEME_BASE, THEME_IDS } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  ANSI_NAMES,
  PALETTES,
  THEME_TOKEN_NAMES,
  paletteFor,
  paletteToXterm,
} from './palettes.js';

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((unit) =>
    unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

describe('theme palettes', () => {
  it('covers every theme id with every token and ANSI color', () => {
    for (const id of THEME_IDS) {
      const palette = PALETTES[id];
      expect(palette, id).toBeDefined();
      expect(Object.keys(palette.tokens).toSorted(), id).toEqual([...THEME_TOKEN_NAMES].toSorted());
      expect(Object.keys(palette.ansi).toSorted(), id).toEqual([...ANSI_NAMES].toSorted());
      expect(palette.base, id).toBe(THEME_BASE[id]);
      expect(palette.label.length, id).toBeGreaterThan(0);
      expect(palette.syntax.length, id).toBeGreaterThan(0);
    }
  });

  it('keeps body text readable on every background', () => {
    for (const id of THEME_IDS) {
      const palette = PALETTES[id];
      expect(contrast(palette.tokens.foreground, palette.tokens.background), id).toBeGreaterThanOrEqual(3);
    }
  });

  it('falls back to dark for an unknown or missing id', () => {
    expect(paletteFor(undefined).id).toBe('dark');
    expect(paletteFor('not-a-theme').id).toBe('dark');
  });

  it('builds an xterm theme with all 16 ANSI colors', () => {
    const xterm = paletteToXterm(PALETTES.dracula);
    expect(xterm.background).toBe(PALETTES.dracula.tokens['terminal-background']);
    expect(xterm.red).toBe(PALETTES.dracula.ansi.red);
    expect(xterm.brightCyan).toBe(PALETTES.dracula.ansi.brightCyan);
    expect(Object.keys(xterm)).toEqual(
      expect.arrayContaining(['background', 'foreground', 'cursor', 'selectionBackground']),
    );
  });
});
