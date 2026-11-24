import { Link, useNavigate } from '@tanstack/react-router';
import type { Thread } from '@tuffcode/contracts';
import { Button, IconButton, ScrollArea, StatusDot, cn } from '@tuffcode/ui';
import { FolderPlus, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAddProject } from '../../hooks/use-add-project';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

export function Sidebar() {
  const projects = useAppStore((state) => state.projects);
  const threadsById = useAppStore((state) => state.threads);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const settings = useAppStore((state) => state.settings);
  const upsertThread = useAppStore((state) => state.upsertThread);
  const setActiveThread = useAppStore((state) => state.setActiveThread);
  const rpc = useRpc();
  const navigate = useNavigate();
  const { addProject, adding } = useAddProject();
  const [creating, setCreating] = useState(false);

  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, Thread[]>();
    for (const project of projects) grouped.set(project.id, []);
    for (const thread of Object.values(threadsById)) {
      const list = grouped.get(thread.projectId);
      if (list) list.push(thread);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return grouped;
  }, [projects, threadsById]);

  const activeProjectId = activeThreadId ? threadsById[activeThreadId]?.projectId : undefined;

  const createThread = useCallback(async () => {
    const project = projects.find((entry) => entry.id === activeProjectId) ?? projects[0];
    if (!project) return;

    const providerId = settings?.defaultProviderId;
    const modelId = settings?.defaultModelId;
    if (!providerId || !modelId) {
      toast.error('Set a default provider and model in settings first.');
      return;
    }

    setCreating(true);
    try {
      const thread = await rpc.request('threads.create', {
        projectId: project.id,
        providerId,
        modelId,
        executionMode: 'work',
        permissionMode: settings.defaultPermissionMode,
      });
      upsertThread(thread);
      setActiveThread(thread.id);
      await navigate({
        to: '/project/$projectId/thread/$threadId',
        params: { projectId: project.id, threadId: thread.id },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the thread.');
    } finally {
      setCreating(false);
    }
  }, [activeProjectId, navigate, projects, rpc, setActiveThread, settings, upsertThread]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2 py-2">
        <Button
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1 justify-start"
          disabled={projects.length === 0 || creating}
          onClick={createThread}
        >
          <Plus strokeWidth={1.75} />
          <span className="truncate">New thread</span>
        </Button>
        <IconButton
          icon={FolderPlus}
          label="Add project"
          size="sm"
          disabled={adding}
          onClick={addProject}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-2 pb-4">
          {projects.length === 0 ? (
            <p className="px-2 py-6 text-xs leading-5 text-sidebar-muted-foreground">
              No projects yet. Add a local repository to start.
            </p>
          ) : null}

          {projects.map((project) => {
            const threads = threadsByProject.get(project.id) ?? [];
            return (
              <section key={project.id} aria-label={project.name}>
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="truncate text-2xs font-medium tracking-wide text-sidebar-muted-foreground uppercase">
                    {project.name}
                  </span>
                  <span className="ml-auto text-2xs tabular-nums text-sidebar-muted-foreground">
                    {threads.length}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5">
                  {threads.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">No threads</p>
                  ) : null}

                  {threads.map((thread) => {
                    const selected = thread.id === activeThreadId;
                    return (
                      <Link
                        key={thread.id}
                        to="/project/$projectId/thread/$threadId"
                        params={{ projectId: project.id, threadId: thread.id }}
                        onClick={() => setActiveThread(thread.id)}
                        className={cn(
                          'flex h-9 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-150',
                          selected
                            ? 'bg-sidebar-row-selected text-sidebar-foreground'
                            : 'text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground',
                        )}
                      >
                        <StatusDot status={thread.status} />
                        <span className="truncate">{thread.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
