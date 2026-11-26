import type { ThreadStatus } from '@tuffcode/contracts';
import { useEffect, useRef } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import {
  hasRunningThread,
  keepAwakeFor,
  notificationFor,
  shouldNotify,
  trackThreadStatus,
} from './notification-model';

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
        if (shouldNotify(settings, focused)) {
          const request = notificationFor(event, {
            settings,
            threads: state.threads,
            previousStatus: previous.current,
          });
          if (request !== null) window.tuffcode.notify(request);
        }
      }
      // Track after judging, so this frame is compared with the status it replaced.
      trackThreadStatus(previous.current, event);
    });
  }, [rpc]);

  const keepAwake = useAppStore((state) => state.settings?.keepAwake ?? false);
  const anyRunning = useAppStore((state) => hasRunningThread(state.threads));
  useEffect(() => {
    window.tuffcode?.setKeepAwake?.(keepAwakeFor(keepAwake, anyRunning));
  }, [anyRunning, keepAwake]);
}
