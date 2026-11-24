export interface BootstrapInfo {
  port: number;
  token: string;
  version: string;
  platform: string;
  home: string;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'protocol-error';

export interface TuffcodeBridge {
  getBootstrap(): Promise<BootstrapInfo>;
  pickFolder(): Promise<string | null>;
  onMenuAction(callback: (action: string) => void): () => void;
  setTheme(theme: 'dark' | 'light' | 'system'): void;
}
