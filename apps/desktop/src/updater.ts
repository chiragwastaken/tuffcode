import { app } from 'electron';
// electron-updater is CommonJS; Node's ESM loader cannot see its named exports,
// so import the module object and destructure it at runtime.
import electronUpdater from 'electron-updater';
import type { Logger } from '@tuffcode/shared';

const { autoUpdater } = electronUpdater;

export const UPDATER_ENV_FLAG = 'TUFFCODE_ENABLE_UPDATES';

export interface UpdaterOptions {
  env?: Record<string, string | undefined>;
  packaged?: boolean;
}

/** Updates stay off unless the app is packaged and the env flag is explicitly set. */
export function updaterEnabled(options: UpdaterOptions = {}): boolean {
  const env = options.env ?? process.env;
  const packaged = options.packaged ?? app.isPackaged;
  return packaged && env[UPDATER_ENV_FLAG] === '1';
}

/** Wires electron-updater without downloading in the background (D15). */
export function setupUpdater(logger: Logger, options: UpdaterOptions = {}): void {
  if (!updaterEnabled(options)) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('error', (error: Error) => {
    logger.error('update check failed', { message: error.message });
  });
  autoUpdater.on('update-available', (info: { version: string }) => {
    logger.info('update available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    logger.debug('no update available');
  });

  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    logger.error('update check failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
