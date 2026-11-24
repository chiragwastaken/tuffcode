// oxlint-disable-next-line import/no-unassigned-import -- the renderer stylesheet is a global side effect
import './styles/theme.css';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { createRpcClient, type RpcClient } from './rpc/client';
import { RpcProvider } from './rpc/rpc-context';
import { router } from './router';
import { useAppStore } from './store/app-store';
import type { BootstrapInfo } from './types';

type Theme = 'dark' | 'light' | 'system';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');
const root = createRoot(container);

function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme): void {
  const element = document.documentElement;
  element.classList.add('no-transitions');
  element.dataset.theme = resolveTheme(theme);
  window.tuffcode.setTheme(theme);
  requestAnimationFrame(() => {
    element.classList.remove('no-transitions');
  });
}

function wireClient(client: RpcClient): void {
  client.onStatus((status) => {
    useAppStore.getState().setConnection(status);
  });

  client.onEvent((event) => {
    const state = useAppStore.getState();
    if (event.type === 'thread.updated') {
      state.upsertThread(event.payload);
    } else if (event.type === 'settings.updated') {
      state.setSettings(event.payload);
      applyTheme(event.payload.theme);
    } else if (event.type === 'providers.updated') {
      useAppStore.setState({ providers: event.payload });
    }
  });
}

async function boot(): Promise<void> {
  let bootstrap: BootstrapInfo;
  try {
    bootstrap = await window.tuffcode.getBootstrap();
  } catch {
    root.render(
      <div className="flex h-screen items-center justify-center bg-background p-6 text-sm text-error">
        Could not start the Tuffcode server bridge.
      </div>,
    );
    return;
  }

  useAppStore.getState().setBootstrap(bootstrap);

  const client = createRpcClient({
    url: `ws://127.0.0.1:${bootstrap.port}/ws`,
    token: bootstrap.token,
  });
  wireClient(client);

  let loadError: unknown = null;
  try {
    await useAppStore.getState().loadInitial(client);
  } catch (error) {
    loadError = error;
  }

  applyTheme(useAppStore.getState().settings?.theme ?? 'dark');

  root.render(
    <StrictMode>
      <RpcProvider client={client}>
        <RouterProvider router={router} />
        <Toaster theme="system" position="bottom-right" closeButton />
      </RpcProvider>
    </StrictMode>,
  );

  if (loadError) {
    const message =
      loadError instanceof Error ? loadError.message : 'Could not load projects from the server.';
    setTimeout(() => toast.error(message), 0);
  }
}

void boot();
