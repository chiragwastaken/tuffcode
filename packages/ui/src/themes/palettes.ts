/**
 * Built-in color palettes.
 *
 * A palette is the 37 design tokens plus a terminal ANSI set and the Shiki theme used
 * for code. Only a handful of colors are authored per theme; the rest are derived so
 * every theme keeps the same contrast relationships. `applyThemePalette` writes the
 * tokens as CSS variables on `<html>`, which is the same surface `tokens.css` uses.
 */
import type { ThemeId } from '@tuffcode/contracts';
import { THEME_LABEL } from '@tuffcode/contracts';
import type { ITheme } from '@xterm/xterm';
import type { BundledTheme } from 'shiki';

/** The color tokens tokens.css maps onto Tailwind utilities. */
export const THEME_TOKEN_NAMES = [
  'background',
  'surface-raised',
  'foreground',
  'card',
  'popover',
  'primary',
  'primary-foreground',
  'secondary',
  'muted',
  'muted-foreground',
  'accent',
  'overlay',
  'message-surface',
  'error',
  'error-foreground',
  'error-surface',
  'border',
  'input',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'warning-surface',
  'info',
  'info-foreground',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-muted-foreground',
  'sidebar-row-hover',
  'sidebar-row-active',
  'sidebar-row-selected',
  'sidebar-border',
  'terminal-background',
  'terminal-foreground',
  'terminal-cursor',
  'terminal-selection',
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export const ANSI_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

export type AnsiName = (typeof ANSI_NAMES)[number];

export interface ThemePalette {
  id: ThemeId;
  label: string;
  base: 'dark' | 'light';
  /** Shiki theme used for markdown code blocks and the diff viewer. */
  syntax: BundledTheme;
  tokens: Record<ThemeTokenName, string>;
  ansi: Record<AnsiName, string>;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgbOf(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function hexOf(rgb: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** `t` is the share of `b`: 0 returns `a`, 1 returns `b`. */
function mix(a: string, b: string, t: number): string {
  const left = rgbOf(a);
  const right = rgbOf(b);
  return hexOf({
    r: left.r + (right.r - left.r) * t,
    g: left.g + (right.g - left.g) * t,
    b: left.b + (right.b - left.b) * t,
  });
}

function alpha(hex: string, percent: number): string {
  const { r, g, b } = rgbOf(hex);
  return `rgb(${String(r)} ${String(g)} ${String(b)} / ${String(percent)}%)`;
}

/** Black or white, whichever reads better on `hex`. */
function contrast(hex: string): string {
  const { r, g, b } = rgbOf(hex);
  const channel = (value: number): number => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? '#000000' : '#ffffff';
}

/** One theme's authored colors. Everything else is derived. */
interface CorePalette {
  background: string;
  foreground: string;
  surface: string;
  border: string;
  /** The theme's link/focus color, mapped to `--primary`. */
  accent: string;
  mutedForeground: string;
  green: string;
  red: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  sidebar?: string;
  syntax: BundledTheme;
  base: 'dark' | 'light';
}

const CORE: Record<ThemeId, CorePalette> = {
  dark: {
    background: '#000000',
    foreground: '#f5f5f5',
    surface: '#131313',
    border: '#232323',
    accent: '#635bff',
    mutedForeground: '#a1a1a1',
    green: '#10b981',
    red: '#fb414a',
    yellow: '#fe9a00',
    blue: '#3b82f6',
    magenta: '#c026d3',
    cyan: '#06b6d4',
    sidebar: '#000000',
    syntax: 'github-dark-default',
    base: 'dark',
  },
  light: {
    background: '#ffffff',
    foreground: '#111113',
    surface: '#f7f7f8',
    border: '#e4e4e7',
    accent: '#635bff',
    mutedForeground: '#5f6067',
    green: '#047857',
    red: '#d92d20',
    yellow: '#b45309',
    blue: '#2563eb',
    magenta: '#a21caf',
    cyan: '#0e7490',
    sidebar: '#fafafa',
    syntax: 'github-light-default',
    base: 'light',
  },
  'one-dark-pro': {
    background: '#282c34',
    foreground: '#abb2bf',
    surface: '#21252b',
    border: '#181a1f',
    accent: '#61afef',
    mutedForeground: '#5c6370',
    green: '#8cc265',
    red: '#e05561',
    yellow: '#d18f52',
    blue: '#4aa5f0',
    magenta: '#c162de',
    cyan: '#42b3c2',
    syntax: 'one-dark-pro',
    base: 'dark',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    surface: '#343746',
    border: '#191a21',
    accent: '#bd93f9',
    mutedForeground: '#6272a4',
    green: '#50fa7b',
    red: '#ff5555',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    sidebar: '#21222c',
    syntax: 'dracula',
    base: 'dark',
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    surface: '#3b4252',
    border: '#434c5e',
    accent: '#88c0d0',
    mutedForeground: '#4c566a',
    green: '#a3be8c',
    red: '#bf616a',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    sidebar: '#2e3440',
    syntax: 'nord',
    base: 'dark',
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    surface: '#073642',
    border: '#586e75',
    accent: '#268bd2',
    mutedForeground: '#586e75',
    green: '#859900',
    red: '#dc322f',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    syntax: 'solarized-dark',
    base: 'dark',
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    surface: '#eee8d5',
    border: '#93a1a1',
    accent: '#268bd2',
    mutedForeground: '#93a1a1',
    green: '#859900',
    red: '#dc322f',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    syntax: 'solarized-light',
    base: 'light',
  },
  'github-dark': {
    background: '#0d1117',
    foreground: '#e6edf3',
    surface: '#161b22',
    border: '#30363d',
    accent: '#1f6feb',
    mutedForeground: '#7d8590',
    green: '#3fb950',
    red: '#ff7b72',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    sidebar: '#010409',
    syntax: 'github-dark',
    base: 'dark',
  },
  'github-light': {
    background: '#ffffff',
    foreground: '#1f2328',
    surface: '#f6f8fa',
    border: '#d0d7de',
    accent: '#0969da',
    mutedForeground: '#656d76',
    green: '#116329',
    red: '#cf222e',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    syntax: 'github-light',
    base: 'light',
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    surface: '#1e1f1c',
    border: '#34352f',
    accent: '#99947c',
    mutedForeground: '#75715e',
    green: '#86b42b',
    red: '#c4265e',
    yellow: '#b3b42b',
    blue: '#6a7ec8',
    magenta: '#8c6bc8',
    cyan: '#56adbc',
    syntax: 'monokai',
    base: 'dark',
  },
  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#a9b1d6',
    surface: '#16161e',
    border: '#101014',
    accent: '#7aa2f7',
    mutedForeground: '#565f89',
    green: '#73daca',
    red: '#f7768e',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    syntax: 'tokyo-night',
    base: 'dark',
  },
  'catppuccin-mocha': {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    surface: '#313244',
    border: '#45475a',
    accent: '#cba6f7',
    mutedForeground: '#a6adc8',
    green: '#a6e3a1',
    red: '#f38ba8',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    syntax: 'catppuccin-mocha',
    base: 'dark',
  },
  'catppuccin-latte': {
    background: '#eff1f5',
    foreground: '#4c4f69',
    surface: '#ccd0da',
    border: '#bcc0cc',
    accent: '#8839ef',
    mutedForeground: '#6c6f85',
    green: '#40a02b',
    red: '#d20f39',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#ea76cb',
    cyan: '#179299',
    syntax: 'catppuccin-latte',
    base: 'light',
  },
  'gruvbox-dark': {
    background: '#282828',
    foreground: '#ebdbb2',
    surface: '#3c3836',
    border: '#504945',
    accent: '#fabd2f',
    mutedForeground: '#928374',
    green: '#b8bb26',
    red: '#fb4934',
    yellow: '#fabd2f',
    blue: '#83a598',
    magenta: '#d3869b',
    cyan: '#8ec07c',
    syntax: 'gruvbox-dark-medium',
    base: 'dark',
  },
  'material-palenight': {
    background: '#292d3e',
    foreground: '#a6accd',
    surface: '#34324a',
    border: '#2b2a3e',
    accent: '#ab47bc',
    mutedForeground: '#676e95',
    green: '#c3e88d',
    red: '#f07178',
    yellow: '#ffcb6b',
    blue: '#82aaff',
    magenta: '#c792ea',
    cyan: '#89ddff',
    syntax: 'material-theme-palenight',
    base: 'dark',
  },
};

function buildPalette(id: ThemeId, core: CorePalette): ThemePalette {
  const { background, foreground, surface, border, accent } = core;
  const dark = core.base === 'dark';
  const sidebar = core.sidebar ?? mix(background, surface, 50);
  const tokens: Record<ThemeTokenName, string> = {
    background,
    'surface-raised': surface,
    foreground,
    card: surface,
    popover: surface,
    primary: accent,
    'primary-foreground': contrast(accent),
    secondary: alpha(foreground, 6),
    muted: alpha(foreground, 6),
    'muted-foreground': core.mutedForeground,
    accent: alpha(foreground, 8),
    overlay: dark ? 'rgb(0 0 0 / 60%)' : 'rgb(0 0 0 / 35%)',
    'message-surface': mix(surface, foreground, 6),
    error: core.red,
    'error-foreground': core.red,
    'error-surface': `color-mix(in srgb, ${core.red} 16%, transparent)`,
    border,
    input: alpha(foreground, 18),
    success: core.green,
    'success-foreground': core.green,
    warning: core.yellow,
    'warning-foreground': core.yellow,
    'warning-surface': `color-mix(in srgb, ${core.yellow} 16%, transparent)`,
    info: core.blue,
    'info-foreground': core.blue,
    ring: accent,
    sidebar,
    'sidebar-foreground': foreground,
    'sidebar-muted-foreground': core.mutedForeground,
    'sidebar-row-hover': surface,
    'sidebar-row-active': mix(surface, foreground, 12),
    'sidebar-row-selected': mix(surface, foreground, 6),
    'sidebar-border': border,
    'terminal-background': mix(background, surface, 40),
    'terminal-foreground': foreground,
    'terminal-cursor': accent,
    'terminal-selection': mix(surface, accent, 35),
  };

  const bright = (color: string): string => mix(color, dark ? '#ffffff' : '#000000', 18);
  const ansi: Record<AnsiName, string> = {
    black: mix(background, '#000000', 50),
    red: core.red,
    green: core.green,
    yellow: core.yellow,
    blue: core.blue,
    magenta: core.magenta,
    cyan: core.cyan,
    white: foreground,
    brightBlack: core.mutedForeground,
    brightRed: bright(core.red),
    brightGreen: bright(core.green),
    brightYellow: bright(core.yellow),
    brightBlue: bright(core.blue),
    brightMagenta: bright(core.magenta),
    brightCyan: bright(core.cyan),
    brightWhite: mix(foreground, '#ffffff', 25),
  };

  return {
    id,
    label: THEME_LABEL[id],
    base: core.base,
    syntax: core.syntax,
    tokens,
    ansi,
  };
}

export const PALETTES: Record<ThemeId, ThemePalette> = Object.fromEntries(
  (Object.keys(CORE) as ThemeId[]).map((id) => [id, buildPalette(id, CORE[id])]),
) as Record<ThemeId, ThemePalette>;

export function paletteFor(id: string | undefined): ThemePalette {
  return id !== undefined && id in PALETTES ? PALETTES[id as ThemeId] : PALETTES.dark;
}

/** The xterm theme for a palette, including the 16 ANSI colors. */
export function paletteToXterm(palette: ThemePalette): ITheme {
  return {
    background: palette.tokens['terminal-background'],
    foreground: palette.tokens['terminal-foreground'],
    cursor: palette.tokens['terminal-cursor'],
    selectionBackground: palette.tokens['terminal-selection'],
    ...palette.ansi,
  };
}
