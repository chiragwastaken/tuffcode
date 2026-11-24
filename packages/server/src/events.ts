import type { ServerEvent } from '@tuffcode/contracts';

export type ServerEventListener = (event: ServerEvent) => void;

export interface EventBus {
  emit(event: ServerEvent): void;
  subscribe(listener: ServerEventListener): () => void;
}

/**
 * In-process fan-out for server events. The WS layer is one subscriber; future
 * slices (runner, council) can add more without knowing about sockets. A throwing
 * listener cannot break delivery to the others.
 */
export function createEventBus(): EventBus {
  const listeners = new Set<ServerEventListener>();
  return {
    emit: (event) => {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Listeners are isolated; one broken consumer must not drop the event.
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
