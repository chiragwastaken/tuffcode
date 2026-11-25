import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BOOTSTRAP_CHANNEL,
  CHECK_UPDATES_CHANNEL,
  KEEP_AWAKE_CHANNEL,
  MENU_ACTION_CHANNEL,
  NOTIFY_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  PICK_FILE_CHANNEL,
  PICK_FOLDER_CHANNEL,
  SET_THEME_CHANNEL,
  type NotifyRequest,
  type PickFileRequest,
  type BootstrapInfo,
  type Theme,
  type TuffcodeBridge,
  type UpdateCheckOutcome,
} from './bridge';

const bridge: TuffcodeBridge = {
  getBootstrap: (): Promise<BootstrapInfo> => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  pickFile: (request: PickFileRequest): Promise<string | null> =>
    ipcRenderer.invoke(PICK_FILE_CHANNEL, request),
  notify: (request: NotifyRequest): void => ipcRenderer.send(NOTIFY_CHANNEL, request),
  setKeepAwake: (on: boolean): void => ipcRenderer.send(KEEP_AWAKE_CHANNEL, on === true),
  openExternal: (url: string): void => ipcRenderer.send(OPEN_EXTERNAL_CHANNEL, url),
  checkForUpdates: (): Promise<UpdateCheckOutcome> => ipcRenderer.invoke(CHECK_UPDATES_CHANNEL),
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, action: unknown): void => {
      if (typeof action === 'string') callback(action);
    };
    ipcRenderer.on(MENU_ACTION_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, listener);
    };
  },
  setTheme: (theme: Theme): void => {
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : theme;
    document.documentElement.dataset.theme = resolved;
    ipcRenderer.send(SET_THEME_CHANNEL, resolved);
  },
};

contextBridge.exposeInMainWorld('tuffcode', bridge);
