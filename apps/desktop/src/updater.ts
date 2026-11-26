import { DatabaseSync } from 'node:sqlite';
import { app, dialog, type BrowserWindow } from 'electron';
// electron-updater is CommonJS; Node's ESM loader cannot see its named exports,
// so import the module object and destructure it at runtime.
import electronUpdater from 'electron-updater';
import { dbPath, type Logger } from '@tuffcode/shared';
import type { UpdateCheckOutcome } from './bridge';

const { autoUpdater } = electronUpdater;

export const DISABLE_UPDATES_ENV = 'TUFFCODE_DISABLE_UPDATES';

/** The release channel a build follows; mirrors the stored `updateChannel` setting. */
export type UpdateChannel = 'stable' | 'beta';

/** electron-updater's name for the feed that carries published releases. */
const STABLE_FEED = 'latest';

/** Delay before the launch check so the window is usable while it runs. */
const LAUNCH_CHECK_DELAY_MS = 3000;

const DISABLED_DETAIL = 'Updates are disabled in this build.';
const BUSY_DETAIL = 'An update check is already in progress.';

export interface UpdaterOptions {
  env?: Record<string, string | undefined>;
  packaged?: boolean;
  /** Release channel; when omitted the stored setting is read from `dbFile`. */
  channel?: UpdateChannel;
  /** Settings database to read the channel from; defaults to the app's user data path. */
  dbFile?: string;
}

export interface SetupUpdaterOptions extends UpdaterOptions {
  getWindow?: () => BrowserWindow | null;
  checkOnStart?: boolean;
}

/** Updates run in packaged builds unless TUFFCODE_DISABLE_UPDATES=1 opts out. */
export function updaterEnabled(options: UpdaterOptions = {}): boolean {
  const env = options.env ?? process.env;
  const packaged = options.packaged ?? app.isPackaged;
  return packaged && env[DISABLE_UPDATES_ENV] !== '1';
}

/**
 * Reads the stored `checkUpdatesOnStart` setting from the settings table. A missing row, a
 * missing table or an unreadable file keeps the launch check on, matching the contract default.
 */
export function checkUpdatesOnStart(dbFile: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('checkUpdatesOnStart');
    if (row === undefined) return true;
    const stored: unknown = JSON.parse(String(row['value']));
    return stored !== false;
  } catch {
    return true;
  } finally {
    db?.close();
  }
}

/**
 * Reads the stored `updateChannel` setting from the settings table. A missing row, a
 * missing table or an unreadable file keeps the contract default, stable.
 */
export function storedUpdateChannel(dbFile: string): UpdateChannel {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('updateChannel');
    if (row === undefined) return 'stable';
    const stored: unknown = JSON.parse(String(row['value']));
    return stored === 'beta' ? 'beta' : 'stable';
  } catch {
    return 'stable';
  } finally {
    db?.close();
  }
}

/** The channel this check follows: the explicit option, else the stored setting. */
export function resolveUpdateChannel(options: UpdaterOptions = {}): UpdateChannel {
  return options.channel ?? storedUpdateChannel(options.dbFile ?? dbPath());
}

/**
 * Points electron-updater at the channel before a check. Stable reads the published
 * `latest` feed and refuses prereleases; beta allows them, so prerelease builds are
 * offered alongside published ones.
 */
export function applyUpdateChannel(channel: UpdateChannel): void {
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.channel = channel === 'beta' ? 'beta' : STABLE_FEED;
}

async function promptRestart(version: string, window: BrowserWindow | null): Promise<void> {
  const options = {
    type: 'info' as const,
    title: 'Update ready',
    message: `Tuffcode ${version} is ready to install.`,
    detail: 'Restart now to apply it. If you choose Later, it installs when you quit.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  };
  const result =
    window === null || window.isDestroyed()
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);
  if (result.response === 0) autoUpdater.quitAndInstall();
}

/** Runs one update check and reports what happened. Never throws. */
export async function checkNow(options: UpdaterOptions = {}): Promise<UpdateCheckOutcome> {
  const checkedAt = new Date().toISOString();
  if (!updaterEnabled(options)) {
    return { status: 'unavailable', version: null, detail: DISABLED_DETAIL, checkedAt };
  }

  try {
    applyUpdateChannel(resolveUpdateChannel(options));
    const result = await autoUpdater.checkForUpdates();
    if (result === null) {
      return { status: 'unavailable', version: null, detail: BUSY_DETAIL, checkedAt };
    }
    const version = result.updateInfo.version;
    const current = app.getVersion();
    if (version !== current) {
      return {
        status: 'available',
        version,
        detail: `Tuffcode ${version} is available.`,
        checkedAt,
      };
    }
    return {
      status: 'current',
      version,
      detail: `Tuffcode ${current} is up to date.`,
      checkedAt,
    };
  } catch (error) {
    return {
      status: 'error',
      version: null,
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
    };
  }
}

/**
 * Wires electron-updater to download in the background, install on quit, and offer a
 * restart once the download lands. The launch check runs once, shortly after startup.
 */
export function setupUpdater(logger: Logger, options: SetupUpdaterOptions = {}): void {
  if (!updaterEnabled(options)) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // The channel must be set before the launch check reads the feed. A manual check
  // applies it again, so a settings change takes effect without a restart.
  applyUpdateChannel(resolveUpdateChannel(options));

  autoUpdater.on('error', (error: Error) => {
    logger.error('update check failed', { message: error.message });
  });
  autoUpdater.on('update-available', (info: { version: string }) => {
    logger.info('update available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    logger.debug('no update available');
  });
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    logger.info('update downloaded', { version: info.version });
    const window = options.getWindow?.() ?? null;
    void promptRestart(info.version, window).catch((error: unknown) => {
      logger.error('update prompt failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  if (options.checkOnStart === false) return;

  setTimeout(() => {
    void checkNow(options).then((outcome) => {
      logger.info('update check finished', {
        status: outcome.status,
        version: outcome.version,
        detail: outcome.detail,
      });
    });
  }, LAUNCH_CHECK_DELAY_MS);
}
