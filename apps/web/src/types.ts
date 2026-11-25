export interface BootstrapInfo {
  port: number;
  token: string;
  version: string;
  platform: string;
  home: string;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'protocol-error';

/** Result of one update check, mirrored from the desktop updater. */
export interface UpdateCheckOutcome {
  status: 'available' | 'current' | 'unavailable' | 'error';
  version: string | null;
  detail: string;
  checkedAt: string;
}

export interface TuffcodeBridge {
  getBootstrap(): Promise<BootstrapInfo>;
  pickFolder(): Promise<string | null>;
  onMenuAction(callback: (action: string) => void): () => void;
  setTheme(theme: 'dark' | 'light' | 'system'): void;
  /** Absent when the preload predates the updater, so callers must guard. */
  checkForUpdates?(): Promise<UpdateCheckOutcome>;
}
