import type { Logger } from '@tuffcode/shared';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkNow, setupUpdater, updaterEnabled } from './updater';

const appMock = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: vi.fn<() => string>(),
}));

const dialogMock = vi.hoisted(() => ({
  showMessageBox: vi.fn<() => Promise<{ response: number }>>(),
}));

vi.mock('electron', () => ({ app: appMock, dialog: dialogMock }));

const updaterMock = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: (event: string, handler: (payload: unknown) => void): void => {
        handlers.set(event, handler);
      },
      checkForUpdates: vi.fn<() => Promise<{ updateInfo: { version: string } } | null>>(),
      quitAndInstall: vi.fn<() => void>(),
    },
  };
});

vi.mock('electron-updater', () => ({ default: { autoUpdater: updaterMock.autoUpdater } }));

interface LogCall {
  level: string;
  message: string;
  fields: Record<string, unknown> | undefined;
}

function createLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      calls.push({ level, message, fields });
    };
  const logger: Logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { logger, calls };
}

function createWindow(destroyed = false): BrowserWindow {
  return { isDestroyed: () => destroyed } as unknown as BrowserWindow;
}

const enabledOptions = { env: {}, packaged: true };

beforeEach(() => {
  updaterMock.handlers.clear();
  updaterMock.autoUpdater.autoDownload = false;
  updaterMock.autoUpdater.autoInstallOnAppQuit = false;
  updaterMock.autoUpdater.checkForUpdates.mockReset();
  updaterMock.autoUpdater.quitAndInstall.mockReset();
  appMock.getVersion.mockReset();
  appMock.getVersion.mockReturnValue('0.1.3');
  dialogMock.showMessageBox.mockReset();
  dialogMock.showMessageBox.mockResolvedValue({ response: 1 });
});

describe('updaterEnabled', () => {
  it('is on for a packaged build with no opt-out flag', () => {
    expect(updaterEnabled({ env: {}, packaged: true })).toBe(true);
  });

  it('is off when TUFFCODE_DISABLE_UPDATES is 1', () => {
    expect(updaterEnabled({ env: { TUFFCODE_DISABLE_UPDATES: '1' }, packaged: true })).toBe(false);
  });

  it('is off outside a packaged build even without the opt-out flag', () => {
    expect(updaterEnabled({ env: {}, packaged: false })).toBe(false);
  });

  it('ignores any other value of the opt-out flag', () => {
    expect(updaterEnabled({ env: { TUFFCODE_DISABLE_UPDATES: '0' }, packaged: true })).toBe(true);
  });
});

describe('checkNow', () => {
  it('reports unavailable without contacting the feed when updates are disabled', async () => {
    const outcome = await checkNow({ env: { TUFFCODE_DISABLE_UPDATES: '1' }, packaged: true });

    expect(outcome.status).toBe('unavailable');
    expect(outcome.version).toBeNull();
    expect(outcome.detail).toBe('Updates are disabled in this build.');
    expect(outcome.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(updaterMock.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('reports an available version when the feed is newer', async () => {
    updaterMock.autoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.1.4' } });

    const outcome = await checkNow(enabledOptions);

    expect(outcome.status).toBe('available');
    expect(outcome.version).toBe('0.1.4');
    expect(outcome.detail).toBe('Tuffcode 0.1.4 is available.');
  });

  it('reports current when the feed matches the running version', async () => {
    updaterMock.autoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.1.3' } });

    const outcome = await checkNow(enabledOptions);

    expect(outcome.status).toBe('current');
    expect(outcome.version).toBe('0.1.3');
    expect(outcome.detail).toBe('Tuffcode 0.1.3 is up to date.');
  });

  it('reports unavailable when a check is already running', async () => {
    updaterMock.autoUpdater.checkForUpdates.mockResolvedValue(null);

    const outcome = await checkNow(enabledOptions);

    expect(outcome.status).toBe('unavailable');
    expect(outcome.version).toBeNull();
    expect(outcome.detail).toBe('An update check is already in progress.');
  });

  it('reports the failure message when the feed throws', async () => {
    updaterMock.autoUpdater.checkForUpdates.mockRejectedValue(new Error('network down'));

    const outcome = await checkNow(enabledOptions);

    expect(outcome.status).toBe('error');
    expect(outcome.version).toBeNull();
    expect(outcome.detail).toBe('network down');
  });
});

describe('setupUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('downloads in the background and installs on quit', () => {
    const { logger } = createLogger();
    setupUpdater(logger, enabledOptions);

    expect(updaterMock.autoUpdater.autoDownload).toBe(true);
    expect(updaterMock.autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it('does nothing when updates are disabled', () => {
    const { logger } = createLogger();
    setupUpdater(logger, { env: { TUFFCODE_DISABLE_UPDATES: '1' }, packaged: true });

    expect(updaterMock.autoUpdater.autoDownload).toBe(false);
    expect(updaterMock.handlers.size).toBe(0);
  });

  it('offers a restart once the download lands and installs on Restart now', async () => {
    const { logger } = createLogger();
    const window = createWindow();
    dialogMock.showMessageBox.mockResolvedValue({ response: 0 });
    setupUpdater(logger, { ...enabledOptions, getWindow: () => window });

    updaterMock.handlers.get('update-downloaded')?.({ version: '0.1.4' });
    await vi.advanceTimersByTimeAsync(0);

    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(window, {
      type: 'info',
      title: 'Update ready',
      message: 'Tuffcode 0.1.4 is ready to install.',
      detail: 'Restart now to apply it. If you choose Later, it installs when you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(updaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('keeps the update for quit when Later is chosen', async () => {
    const { logger } = createLogger();
    setupUpdater(logger, { ...enabledOptions, getWindow: () => createWindow() });

    updaterMock.handlers.get('update-downloaded')?.({ version: '0.1.4' });
    await vi.advanceTimersByTimeAsync(0);

    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1);
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('shows the dialog without a parent when no window is available', async () => {
    const { logger } = createLogger();
    setupUpdater(logger, { ...enabledOptions, getWindow: () => createWindow(true) });

    updaterMock.handlers.get('update-downloaded')?.({ version: '0.1.4' });
    await vi.advanceTimersByTimeAsync(0);

    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Update ready' }),
    );
  });

  it('checks once shortly after startup and logs the result', async () => {
    const { logger, calls } = createLogger();
    updaterMock.autoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.1.3' } });
    setupUpdater(logger, enabledOptions);

    await vi.advanceTimersByTimeAsync(2999);
    expect(updaterMock.autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(updaterMock.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(calls).toContainEqual({
      level: 'info',
      message: 'update check finished',
      fields: { status: 'current', version: '0.1.3', detail: 'Tuffcode 0.1.3 is up to date.' },
    });
  });
});
