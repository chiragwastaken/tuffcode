import { describe, expect, it } from 'vitest';
import { DENSITY_TOKENS, resolveTheme, rootFontSize } from './appearance';

describe('appearance values', () => {
  it('keeps the default font size at the design root', () => {
    expect(rootFontSize(14)).toBe(16);
    expect(rootFontSize(16)).toBeCloseTo(18.29, 2);
    expect(rootFontSize(12)).toBeCloseTo(13.71, 2);
  });

  it('scales density from compact to comfortable', () => {
    expect(DENSITY_TOKENS.compact.rowHeight).toBeLessThan(DENSITY_TOKENS.default.rowHeight);
    expect(DENSITY_TOKENS.default.rowHeight).toBeLessThan(DENSITY_TOKENS.comfortable.rowHeight);
    expect(DENSITY_TOKENS.compact.buttonHeight).toBeLessThan(DENSITY_TOKENS.default.buttonHeight);
    expect(DENSITY_TOKENS.default.buttonHeight).toBeLessThan(
      DENSITY_TOKENS.comfortable.buttonHeight,
    );
  });

  it('resolves the system theme against the OS preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});
