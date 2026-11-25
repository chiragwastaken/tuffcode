import { useNavigate, useRouter } from '@tanstack/react-router';
import type { Project, Thread } from '@tuffcode/contracts';
import { Button, EmptyState, IconButton, Input, Kbd } from '@tuffcode/ui';
import { FolderPlus, Search, SearchX, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import { useAddProject } from '../../hooks/use-add-project';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { requestInspectorTab } from '../inspector/panel-requests';
import { childForThread } from '../subagents/subagent-model';
import { requestThreadDelete, requestThreadRename } from '../thread/thread-dialogs';
import { RemoveProjectDialog } from './RemoveProjectDialog';
import { SidebarList, type SidebarItemActions } from './SidebarList';
import {
  buildSidebarItems,
  filterGroups,
  groupThreadsByProject,
  isCouncilChild,
  needsVirtualization,
  readCollapsedProjects,
  writeCollapsedProjects,
} from './sidebar-model';

export function Sidebar() {
  const projects = useAppStore((state) => state.projects);
  const threadsById = useAppStore((state) => state.threads);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const settings = useAppStore((state) => state.settings);
  const upsertThread = useAppStore((state) => state.upsertThread);
  const setActiveThread = useAppStore((state) => state.setActiveThread);
  const openSubagent = useAppStore((state) => state.openSubagent);

  const rpc = useRpc();
  const navigate = useNavigate();
  const router = useRouter();
  const { addProject, adding } = useAddProject();

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    readCollapsedProjects(typeof window === 'undefined' ? null : window.localStorage),
  );
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const searchRef = useRef<HTMLElement>(null);

  const groups = useMemo(
    () => groupThreadsByProject(projects, Object.values(threadsById)),
    [projects, threadsById],
  );
  const filteredGroups = useMemo(() => filterGroups(groups, query), [groups, query]);
  const searching = query.trim().length > 0;
  const isCollapsed = useCallback(
    (projectId: string) => !searching && collapsed.has(projectId),
    [collapsed, searching],
  );
  const items = useMemo(
    () => buildSidebarItems(filteredGroups, isCollapsed),
    [filteredGroups, isCollapsed],
  );
  const virtual = needsVirtualization(filteredGroups);

  const createThread = useCallback(
    async (projectId: string) => {
      const providerId = settings?.defaultProviderId;
      const modelId = settings?.defaultModelId;
      if (!providerId || !modelId) {
        toast.error('Set a default provider and model in Settings before creating a thread.');
        return;
      }

      setCreatingProjectId(projectId);
      try {
        const thread = await rpc.request('threads.create', {
          projectId,
          providerId,
          modelId,
          executionMode: 'work',
          permissionMode: settings?.defaultPermissionMode ?? 'ask',
        });
        upsertThread(thread);
        setActiveThread(thread.id);
        await navigate({
          to: '/project/$projectId/thread/$threadId',
          params: { projectId, threadId: thread.id },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not create the thread.');
      } finally {
        setCreatingProjectId(null);
      }
    },
    [navigate, rpc, setActiveThread, settings, upsertThread],
  );

  const clearSearch = useCallback(() => {
    setQuery('');
    searchRef.current?.focus();
  }, []);

  const handleToggleProject = useCallback((projectId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      writeCollapsedProjects(typeof window === 'undefined' ? null : window.localStorage, next);
      return next;
    });
  }, []);

  const handleSelectThread = useCallback(
    (threadId: string) => setActiveThread(threadId),
    [setActiveThread],
  );

  const handleOpenThread = useCallback(
    (thread: Thread) => {
      setActiveThread(thread.id);
      void navigate({
        to: '/project/$projectId/thread/$threadId',
        params: { projectId: thread.projectId, threadId: thread.id },
      });
    },
    [navigate, setActiveThread],
  );

  const projectPathFor = useCallback(
    (projectId: string) => projects.find((project) => project.id === projectId)?.path,
    [projects],
  );

  /**
   * A child row opens its parent thread. A live subagent also opens the child
   * pane; a council child with no live subagent shows the council board instead.
   */
  const handleOpenChild = useCallback(
    (thread: Thread, parentId: string) => {
      setActiveThread(parentId);
      void navigate({
        to: '/project/$projectId/thread/$threadId',
        params: { projectId: thread.projectId, threadId: parentId },
      });

      // Read the live children without subscribing: child frames mutate the map
      // on every token and the sidebar must not re-render for them.
      const live = childForThread(useAppStore.getState().subagents, thread.id);
      if (live !== undefined) {
        openSubagent(live.childId);
        return;
      }
      if (isCouncilChild(thread)) requestInspectorTab('council');
    },
    [navigate, openSubagent, setActiveThread],
  );

  const handleNewThread = useCallback(
    (projectId: string) => void createThread(projectId),
    [createThread],
  );

  const handleRemoveProject = useCallback((project: Project) => setRemoveTarget(project), []);

  const handleProjectRemoved = useCallback(
    (project: Project) => {
      if (router.state.location.pathname.startsWith(`/project/${project.id}/`)) {
        void navigate({ to: '/' });
      }
    },
    [navigate, router],
  );

  const closeRemoveDialog = useCallback(() => setRemoveTarget(null), []);

  const actions = useMemo<SidebarItemActions>(
    () => ({
      activeThreadId,
      creatingProjectId,
      projectPathFor,
      onSelectThread: handleSelectThread,
      onOpenThread: handleOpenThread,
      onOpenChild: handleOpenChild,
      onRenameThread: requestThreadRename,
      onDeleteThread: requestThreadDelete,
      onToggleProject: handleToggleProject,
      onNewThread: handleNewThread,
      onRemoveProject: handleRemoveProject,
    }),
    [
      activeThreadId,
      creatingProjectId,
      handleNewThread,
      handleOpenChild,
      handleOpenThread,
      handleRemoveProject,
      handleSelectThread,
      handleToggleProject,
      projectPathFor,
    ],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (target.closest('input, textarea, select, [role="dialog"]')) return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (query !== '') setQuery('');
    else event.currentTarget.blur();
  }

  const removeThreadCount = removeTarget
    ? (groups.find((group) => group.project.id === removeTarget.id)?.threads.length ?? 0)
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 py-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-sidebar-muted-foreground"
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search projects and threads"
            aria-label="Search projects and threads"
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-full border-sidebar-border bg-secondary pr-8 pl-7 text-xs"
          />
          {query !== '' ? (
            <IconButton
              icon={X}
              label="Clear search"
              size="sm"
              onClick={clearSearch}
              className="absolute top-1/2 right-0 size-6 -translate-y-1/2"
            />
          ) : (
            <Kbd className="pointer-events-none absolute top-1/2 right-1.5 h-4 min-w-4 -translate-y-1/2">
              /
            </Kbd>
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="min-h-0 flex-1" />
      ) : filteredGroups.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <EmptyState
            icon={SearchX}
            title="No matches"
            action={
              <Button size="sm" variant="outline" onClick={clearSearch}>
                Clear search
              </Button>
            }
            className="mt-2 min-h-0 px-3 py-6"
          />
        </div>
      ) : (
        <SidebarList items={items} virtual={virtual} actions={actions} />
      )}

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <Button
          data-testid="sidebar-add-project"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-muted-foreground"
          disabled={adding}
          onClick={addProject}
        >
          <FolderPlus strokeWidth={1.75} />
          Add project
        </Button>
      </div>

      <RemoveProjectDialog
        project={removeTarget}
        threadCount={removeThreadCount}
        onClose={closeRemoveDialog}
        onRemoved={handleProjectRemoved}
      />
    </div>
  );
}
