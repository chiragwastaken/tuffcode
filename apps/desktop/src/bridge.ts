export interface BootstrapInfo {
  port: number;
  token: string;
  version: string;
  platform: string;
  home: string;
}

export type Theme = 'dark' | 'light' | 'system';

/** The only surface exposed to the renderer through the preload bridge (spec section 10). */
export interface TuffcodeBridge {
  getBootstrap(): Promise<BootstrapInfo>;
  pickFolder(): Promise<string | null>;
  onMenuAction(callback: (action: string) => void): () => void;
  setTheme(theme: Theme): void;
}

export const BOOTSTRAP_CHANNEL = 'bootstrap:get';
export const PICK_FOLDER_CHANNEL = 'dialog:pick-folder';
export const MENU_ACTION_CHANNEL = 'menu:action';
export const SET_THEME_CHANNEL = 'theme:set';

export const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}
