import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BOOTSTRAP_CHANNEL,
  MENU_ACTION_CHANNEL,
  PICK_FOLDER_CHANNEL,
  SET_THEME_CHANNEL,
  type BootstrapInfo,
  type Theme,
  type TuffcodeBridge,
} from './bridge';

const bridge: TuffcodeBridge = {
  getBootstrap: (): Promise<BootstrapInfo> => ipcRenderer.invoke(BOOTSTRAP_CHANNEL),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
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
    ipcRenderer.send(SET_THEME_CHANNEL, theme);
  },
};

contextBridge.exposeInMainWorld('tuffcode', bridge);
