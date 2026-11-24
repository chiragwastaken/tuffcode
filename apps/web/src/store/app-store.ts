import type {
  Project,
  ProviderView,
  RpcMethod,
  RpcParams,
  RpcResult,
  Settings,
  Thread,
  ThreadEventRow,
} from '@tuffcode/contracts';
import { create } from 'zustand';
import type { BootstrapInfo, ConnectionStatus } from '../types';

export const MAX_EVENTS_PER_THREAD = 5000;

export interface RpcRequester {
  request<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
}

export interface AppState {
  connection: ConnectionStatus;
  bootstrap: BootstrapInfo | null;
  projects: Project[];
  threads: Record<string, Thread>;
  events: Record<string, ThreadEventRow[]>;
  settings: Settings | null;
  providers: ProviderView[];
  activeThreadId: string | null;

  setBootstrap(bootstrap: BootstrapInfo): void;
  setConnection(connection: ConnectionStatus): void;
  loadInitial(rpc: RpcRequester): Promise<void>;
  upsertProject(project: Project): void;
  removeProject(projectId: string): void;
  upsertThread(thread: Thread): void;
  removeThread(threadId: string): void;
  appendEvent(threadId: string, event: ThreadEventRow): void;
  setSettings(settings: Settings): void;
  upsertProvider(provider: ProviderView): void;
  setActiveThread(threadId: string | null): void;
}

const initialState = {
  connection: 'connecting' as ConnectionStatus,
  bootstrap: null,
  projects: [] as Project[],
  threads: {} as Record<string, Thread>,
  events: {} as Record<string, ThreadEventRow[]>,
  settings: null,
  providers: [] as ProviderView[],
  activeThreadId: null,
};

export function createAppStore() {
  return create<AppState>()((set) => ({
    ...initialState,

    setBootstrap: (bootstrap) => set({ bootstrap }),

    setConnection: (connection) => set({ connection }),

    loadInitial: async (rpc) => {
      const [projects, threads, settings, providers] = await Promise.all([
        rpc.request('projects.list', {}),
        rpc.request('threads.list', {}),
        rpc.request('settings.get', {}),
        rpc.request('providers.list', {}),
      ]);

      set({
        projects,
        threads: Object.fromEntries(threads.map((thread) => [thread.id, thread])),
        settings,
        providers,
      });
    },

    upsertProject: (project) =>
      set((state) => {
        const index = state.projects.findIndex((entry) => entry.id === project.id);
        if (index === -1) return { projects: [...state.projects, project] };
        const projects = state.projects.slice();
        projects[index] = project;
        return { projects };
      }),

    removeProject: (projectId) =>
      set((state) => {
        const removedThreadIds = new Set(
          Object.values(state.threads)
            .filter((thread) => thread.projectId === projectId)
            .map((thread) => thread.id),
        );
        const threads = Object.fromEntries(
          Object.entries(state.threads).filter(([threadId]) => !removedThreadIds.has(threadId)),
        );
        const events = Object.fromEntries(
          Object.entries(state.events).filter(([threadId]) => !removedThreadIds.has(threadId)),
        );
        return {
          projects: state.projects.filter((project) => project.id !== projectId),
          threads,
          events,
          activeThreadId:
            state.activeThreadId && removedThreadIds.has(state.activeThreadId)
              ? null
              : state.activeThreadId,
        };
      }),

    upsertThread: (thread) =>
      set((state) => ({
        threads: { ...state.threads, [thread.id]: thread },
      })),

    removeThread: (threadId) =>
      set((state) => {
        const threads = { ...state.threads };
        delete threads[threadId];
        const events = { ...state.events };
        delete events[threadId];
        return {
          threads,
          events,
          activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
        };
      }),

    appendEvent: (threadId, event) =>
      set((state) => {
        const list = state.events[threadId] ?? [];
        const last = list[list.length - 1];
        if (last && event.seq <= last.seq) return {};

        const next = [...list, event];
        if (next.length > MAX_EVENTS_PER_THREAD) {
          next.splice(0, next.length - MAX_EVENTS_PER_THREAD);
        }

        const thread = state.threads[threadId];
        const threads =
          thread && event.seq > thread.lastSeq
            ? { ...state.threads, [threadId]: { ...thread, lastSeq: event.seq } }
            : state.threads;

        return {
          events: { ...state.events, [threadId]: next },
          threads,
        };
      }),

    setSettings: (settings) => set({ settings }),

    upsertProvider: (provider) =>
      set((state) => {
        const index = state.providers.findIndex((entry) => entry.id === provider.id);
        if (index === -1) return { providers: [...state.providers, provider] };
        const providers = state.providers.slice();
        providers[index] = provider;
        return { providers };
      }),

    setActiveThread: (activeThreadId) => set({ activeThreadId }),
  }));
}

export const useAppStore = createAppStore();
