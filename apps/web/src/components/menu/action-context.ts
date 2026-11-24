import { useMemo } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import type { ActionContext } from '../actions';

/** The non-target services every action needs, wired to the app's live ports. */
export type ActionPorts = Pick<ActionContext, 'rpc' | 'clipboard' | 'notify' | 'store'>;

export function useActionPorts(): ActionPorts {
  const rpc = useRpc();

  return useMemo<ActionPorts>(() => {
    const store = useAppStore.getState();
    return {
      rpc,
      clipboard: {
        writeText: (text) => navigator.clipboard.writeText(text),
        readText: () => navigator.clipboard.readText(),
      },
      notify: {
        success: (message) => toast.success(message),
        error: (message) => toast.error(message),
      },
      store: {
        upsertThread: store.upsertThread,
        removeThread: store.removeThread,
        removeMessage: store.removeMessage,
      },
    };
  }, [rpc]);
}
