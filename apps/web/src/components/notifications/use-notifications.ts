import type { ThreadStatus } from '@tuffcode/contracts';
import { useEffect, useRef } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { notificationFor } from './notification-model';

/**
 * Desktop notifications and keep-awake. Notifications follow the Notifications
 * settings and, by default, only fire while the window is not focused. Keep-awake
 * holds one power blocker while any thread runs and the setting is on.
 */
export function useNotifications(): void {
  const rpc = useRpc();
  const previous = useRef(new Map<string, ThreadStatus>());

  useEffect(() => {
    const seed = useAppStore.getState().threads;
    for (const thread of Object.values(seed)) previous.current.set(thread.id, thread.status);
    return rpc.onEvent((event) => {
      const state = useAppStore.getState();
      const settings = state.settings?.notifications;
      if (settings !== undefined && window.tuffcode?.notify !== undefined) {
        const focused = typeof document !== 'undefined' && document.hasFocus();
        if (!(settings.onlyWhenUnfocused && focused)) {
          const request = notificationFor(event, {
            settings,
            threads: state.threads,
            previousStatus: previous.current,
          });
          if (request !== null) window.tuffcode.notify(request);
        }
      }
      if (event.type === 'thread.updated') previous.current.set(event.payload.id, event.payload.status);
    });
  }, [rpc]);

  const keepAwake = useAppStore((state) => state.settings?.keepAwake ?? false);
  const anyRunning = useAppStore((state) =>
    Object.values(state.threads).some((thread) => thread.status === 'running'),
  );
  useEffect(() => {
    window.tuffcode?.setKeepAwake?.(keepAwake && anyRunning);
  }, [anyRunning, keepAwake]);
}
