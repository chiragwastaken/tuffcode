import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type OpenDialogOptions } from 'electron';
import { serverJsonPath, tuffcodeHome } from '@tuffcode/shared';
import {
  BOOTSTRAP_CHANNEL,
  PICK_FOLDER_CHANNEL,
  SET_THEME_CHANNEL,
  attachSecretBridge,
  isTheme,
  type BootstrapInfo,
} from './bridge';
import { createMainLogger } from './logger';
import { createApplicationMenu } from './menu';
import { createSecretStore } from './secrets';
import {
  readServerConnection,
  resolveServerEntry,
  serverBuildCommand,
  startServer,
  stopServer,
  type RunningServer,
} from './server';
import { setupUpdater } from './updater';
import { resolveUserDataPath } from './user-data';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const logger = createMainLogger();

let mainWindow: BrowserWindow | null = null;
let server: RunningServer | null = null;
let bootstrap: BootstrapInfo | null = null;
let isQuitting = false;

app.setName('Tuffcode');

// The single-instance lock is keyed on `userData`, so an override has to land before
// `requestSingleInstanceLock()` below. Tests and parallel worktrees set this to a temp
// directory to keep their locks and Chromium state apart.
const userDataPath = resolveUserDataPath();
if (userDataPath !== undefined) {
  mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
}

function rendererIndexFile(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'web', 'index.html')
    : resolve(app.getAppPath(), '../web/dist/index.html');
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 400,
    minHeight: 360,
    backgroundColor: '#000000',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#01000000',
      symbolColor: '#f8fafc',
      height: 40,
    },
    webPreferences: {
      preload: join(currentDir, '../preload/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });

  return window;
}

function registerIpcHandlers(): void {
  ipcMain.handle(BOOTSTRAP_CHANNEL, (): BootstrapInfo => {
    if (bootstrap === null) throw new Error('The Tuffcode server is not ready yet.');
    return bootstrap;
  });

  ipcMain.handle(PICK_FOLDER_CHANNEL, async (event): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: 'Add project',
      properties: ['openDirectory', 'createDirectory'],
    };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result =
      parent === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(parent, options);
    const [folder] = result.filePaths;
    return result.canceled || folder === undefined ? null : folder;
  });

  ipcMain.on(SET_THEME_CHANNEL, (_event, theme: unknown) => {
    if (!isTheme(theme)) return;
    nativeTheme.themeSource = theme;
  });
}

async function loadRenderer(window: BrowserWindow, port: number): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl !== undefined && devUrl.length > 0) {
    const url = new URL(devUrl);
    url.searchParams.set('port', String(port));
    await window.loadURL(url.toString());
    return;
  }

  const indexHtml = rendererIndexFile();
  if (!existsSync(indexHtml)) {
    throw new Error(`The renderer build is missing at ${indexHtml}. Run the desktop build first.`);
  }
  await window.loadFile(indexHtml, { query: { port: String(port) } });
}

function showStartupError(title: string, detail: string): void {
  logger.error('startup failed', { title, detail });
  dialog.showErrorBox(title, detail);
}

async function startServerProcess(): Promise<RunningServer | null> {
  const entry = resolveServerEntry({
    envEntry: process.env['TUFFCODE_SERVER_ENTRY'],
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });

  if (!existsSync(entry)) {
    showStartupError(
      'Tuffcode server not found',
      `The server bundle is missing at ${entry}.\n\nBuild it first:\n  ${serverBuildCommand()}`,
    );
    return null;
  }

  try {
    return await startServer({
      entry,
      env: {
        ...process.env,
        TUFFCODE_HOME: tuffcodeHome(),
        TUFFCODE_APP_VERSION: app.getVersion(),
      },
      logger,
    });
  } catch (error) {
    showStartupError(
      'Tuffcode could not start',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function readBootstrap(port: number): BootstrapInfo | null {
  try {
    const connection = readServerConnection(serverJsonPath(), port);
    return {
      port: connection.port,
      token: connection.token,
      version: app.getVersion(),
      platform: process.platform,
      home: tuffcodeHome(),
    };
  } catch (error) {
    showStartupError(
      'Tuffcode could not read the server connection',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function bootstrapApplication(): Promise<void> {
  logger.info('starting main process', { version: app.getVersion(), packaged: app.isPackaged });
  app.setAppUserModelId('net.tuffcode.app');

  registerIpcHandlers();
  const window = createWindow();
  mainWindow = window;
  createApplicationMenu(window);

  const secretStore = createSecretStore();
  const running = await startServerProcess();
  if (running === null) {
    app.quit();
    return;
  }
  server = running;
  attachSecretBridge(running.child, secretStore, logger);

  const info = readBootstrap(running.port);
  if (info === null) {
    server = null;
    await stopServer(running, logger).catch(() => undefined);
    app.quit();
    return;
  }
  bootstrap = info;

  try {
    await loadRenderer(window, running.port);
  } catch (error) {
    showStartupError(
      'Tuffcode could not load its interface',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }

  void running.exited.then((code) => {
    if (isQuitting) return;
    logger.warn('server exited unexpectedly', { code });
  });

  setupUpdater(logger);
  logger.info('main process ready', { port: running.port });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (isQuitting || server === null) return;
    event.preventDefault();
    isQuitting = true;
    const running = server;
    server = null;
    void stopServer(running, logger).finally(() => {
      app.quit();
    });
  });

  void app
    .whenReady()
    .then(bootstrapApplication)
    .catch((error: unknown) => {
      showStartupError(
        'Tuffcode could not start',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}
