/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** Tokens copied verbatim from spec section 9.1 (names only, values live in the CSS). */
const SPEC_TOKENS = [
  '--background',
  '--surface-raised',
  '--foreground',
  '--card',
  '--popover',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--message-surface',
  '--error',
  '--error-foreground',
  '--error-surface',
  '--border',
  '--input',
  '--success',
  '--success-foreground',
  '--warning',
  '--warning-foreground',
  '--warning-surface',
  '--info',
  '--info-foreground',
  '--ring',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-muted-foreground',
  '--sidebar-row-hover',
  '--sidebar-row-active',
  '--sidebar-row-selected',
  '--sidebar-border',
  '--terminal-background',
  '--terminal-foreground',
  '--terminal-cursor',
  '--terminal-selection',
  '--radius',
] as const;

/** Everything above except the radius is a color and must be redefined for light. */
const SPEC_COLOR_TOKENS = SPEC_TOKENS.filter((token) => token !== '--radius');

function block(selector: string): string {
  let start = -1;
  let cursor = css.indexOf(selector);
  while (cursor !== -1) {
    let next = cursor + selector.length;
    while (next < css.length && /\s/.test(css[next] ?? '')) next += 1;
    if (css[next] === '{') {
      start = cursor;
      break;
    }
    cursor = css.indexOf(selector, cursor + selector.length);
  }
  if (start === -1) throw new Error(`missing block: ${selector}`);
  const open = css.indexOf('{', start);
  if (open === -1) throw new Error(`missing opening brace for: ${selector}`);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated block: ${selector}`);
}

function declarations(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of source.split('\n')) {
    const match = /^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/.exec(line);
    if (match?.[1] && match[2]) found.set(match[1], match[2]);
  }
  return found;
}

const dark = declarations(block(':root'));
const light = declarations(block("[data-theme='light']"));
const theme = block('@theme inline');
const fontTheme = block('@theme');

describe('design tokens', () => {
  it('declares every spec 9.1 token in the dark theme', () => {
    for (const token of SPEC_TOKENS) {
      expect(dark.has(token), `missing ${token}`).toBe(true);
      expect(dark.get(token), `empty ${token}`).not.toBe('');
    }
  });

  it('redefines every spec color token for the light theme', () => {
    for (const token of SPEC_COLOR_TOKENS) {
      expect(light.has(token), `light theme missing ${token}`).toBe(true);
      expect(light.get(token), `light theme empty ${token}`).not.toBe('');
    }
    expect(light.get('--background')).not.toBe(dark.get('--background'));
    expect(light.get('--foreground')).not.toBe(dark.get('--foreground'));
    expect(light.get('--sidebar')).not.toBe(dark.get('--sidebar'));
  });

  it('maps every spec color onto a Tailwind color utility', () => {
    for (const token of SPEC_COLOR_TOKENS) {
      const name = token.slice('--'.length);
      expect(theme).toContain(`--color-${name}: var(${token});`);
    }
  });

  it('exposes the radius and text scales to Tailwind', () => {
    expect(theme).toContain('--radius-sm:');
    expect(theme).toContain('--radius-md: var(--radius);');
    expect(theme).toContain('--radius-lg:');
    expect(theme).toContain('--radius-xl:');
    expect(theme).toContain('--radius-2xl:');
    expect(theme).toContain('--text-2xs:');
  });

  it('declares the font families as runtime theme variables', () => {
    expect(fontTheme).toContain('--font-sans:');
    expect(fontTheme).toContain('--font-mono:');
    expect(fontTheme).toContain('Inter Variable');
    expect(fontTheme).toContain('Segoe UI');
    expect(fontTheme).toContain('JetBrains Mono Variable');
    expect(fontTheme).toContain('Consolas');
  });

  it('never hardcodes a color inside the theme mapping', () => {
    const colorDeclarations = theme.match(/--color-[\w-]+\s*:/g) ?? [];
    const mappedDeclarations = theme.match(/--color-[\w-]+\s*:\s*var\(--[\w-]+\);/g) ?? [];
    expect(colorDeclarations.length).toBeGreaterThan(30);
    expect(mappedDeclarations.length).toBe(colorDeclarations.length);
  });
});
