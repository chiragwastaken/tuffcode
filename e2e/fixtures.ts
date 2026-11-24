import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockOpenAI, type MockOpenAI } from './mock-openai';
import { connectRpc, type HarnessRpc } from './rpc';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export interface E2EWorkspace {
  root: string;
  home: string;
  localAppData: string;
  appData: string;
  projectPath: string;
}

function stringEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/**
 * A temp home, a temp app-data tree, and a real git repository. The app never sees
 * the developer's profile: TUFFCODE_HOME, LOCALAPPDATA, and APPDATA are all redirected.
 * USERPROFILE and HOME stay untouched because Electron aborts when they move.
 */
export function createWorkspace(): E2EWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'tuffcode-e2e-'));
  const home = join(root, 'home');
  const localAppData = join(root, 'localappdata');
  const appData = join(root, 'appdata');
  const projectPath = join(root, 'project');
  for (const dir of [home, localAppData, appData, projectPath]) {
    mkdirSync(dir, { recursive: true });
  }

  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: projectPath, stdio: 'ignore' });
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'e2e@example.test']);
  git(['config', 'user.name', 'Tuffcode E2E']);
  writeFileSync(join(projectPath, 'README.md'), '# e2e project\n');
  mkdirSync(join(projectPath, 'src'), { recursive: true });
  writeFileSync(join(projectPath, 'src', 'index.ts'), 'export const answer = 42;\n');
  git(['add', '.']);
  git(['commit', '-m', 'initial commit']);

  return { root, home, localAppData, appData, projectPath };
}

export interface AppSession {
  app: ElectronApplication;
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
  close(): Promise<void>;
  relaunch(): Promise<void>;
}

async function launchOnce(workspace: E2EWorkspace): Promise<{
  app: ElectronApplication;
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
}> {
  const app = await electron.launch({
    // The renderer is software-only in the harness: GPU init is flaky on Windows
    // builders and nothing here asserts pixels.
    args: ['--disable-gpu', 'apps/desktop'],
    cwd: repoRoot,
    env: {
      ...stringEnv(process.env),
      TUFFCODE_HOME: workspace.home,
      LOCALAPPDATA: workspace.localAppData,
      APPDATA: workspace.appData,
    },
    timeout: 60_000,
  });

  const page = await app.firstWindow({ timeout: 30_000 });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.waitForLoadState('domcontentloaded');
  // The inspector column only renders at the xl breakpoint; the default window is 1100px.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) window.setSize(1440, 900);
  });
  await expect(page.getByTestId('app-shell')).toBeVisible();
  return { app, page, consoleErrors, pageErrors };
}

export async function launchApp(workspace: E2EWorkspace): Promise<AppSession> {
  const first = await launchOnce(workspace);
  const session: AppSession = {
    app: first.app,
    page: first.page,
    consoleErrors: first.consoleErrors,
    pageErrors: first.pageErrors,
    close: async () => {
      await session.app.close();
    },
    relaunch: async () => {
      await session.app.close();
      const next = await launchOnce(workspace);
      session.app = next.app;
      session.page = next.page;
      session.consoleErrors.length = 0;
      session.pageErrors.length = 0;
      session.consoleErrors.push(...next.consoleErrors);
      session.pageErrors.push(...next.pageErrors);
    },
  };
  return session;
}

/**
 * Replaces the native folder picker with a fixed answer. The Add project flow calls
 * the real IPC handler and dialog module, only the OS dialog itself is stubbed.
 */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(async ({ dialog }, target) => {
    Object.assign(dialog, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [target] }),
    });
  }, folder);
}

export interface Fixtures {
  workspace: E2EWorkspace;
  mock: MockOpenAI;
  session: AppSession;
  rpc: HarnessRpc;
}

export const test = base.extend<Fixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixtures require destructuring.
  workspace: async ({}, use) => {
    await use(createWorkspace());
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixtures require destructuring.
  mock: async ({}, use) => {
    const mock = await startMockOpenAI();
    await use(mock);
    await mock.close();
  },
  session: async ({ workspace }, use) => {
    const session = await launchApp(workspace);
    await use(session);
    await session.close().catch(() => undefined);
  },
  rpc: async ({ workspace }, use) => {
    const rpc = await connectRpc(workspace.home);
    await use(rpc);
    rpc.close();
  },
});

export { expect };
