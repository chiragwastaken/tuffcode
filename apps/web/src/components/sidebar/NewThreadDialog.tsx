import type { Thread } from '@tuffcode/contracts';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Select,
  Spinner,
  cn,
} from '@tuffcode/ui';
import { Folder, FolderGit2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import {
  buildCreateThreadParams,
  resolveInitialProject,
  workspaceChoices,
  workspaceConsequence,
  workspaceSummary,
  type WorkspaceChoice,
} from './new-thread-dialog-model';

export interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected project: the active thread's, else the most recent one. */
  preferredProjectId: string | null;
  /** Opens the folder picker; the dialog never adds a project on its own. */
  onAddProject: () => void;
  onCreated: (thread: Thread) => void;
}

/**
 * New chat. The thread runs in the chosen project's folder unless the user picks an
 * isolated worktree, and nothing is created until Start. With no projects the dialog
 * explains why a folder is needed and offers Add project instead of creating one.
 */
export function NewThreadDialog({
  open,
  onOpenChange,
  preferredProjectId,
  onAddProject,
  onCreated,
}: NewThreadDialogProps) {
  const rpc = useRpc();
  const projects = useAppStore((state) => state.projects);
  const settings = useAppStore((state) => state.settings);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceChoice>('folder');
  const [creating, setCreating] = useState(false);
  const wasOpen = useRef(false);

  const worktreesEnabled = settings?.capabilities.worktrees ?? true;
  const choices = workspaceChoices(worktreesEnabled);
  const selectedProjectId = projectId ?? resolveInitialProject(projects, preferredProjectId);
  const project = projects.find((entry) => entry.id === selectedProjectId) ?? projects[0];
  const effectiveWorkspace: WorkspaceChoice = choices.includes(workspace) ? workspace : 'folder';

  // Reset only when the dialog opens: project list churn must not clobber a choice.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setProjectId(resolveInitialProject(projects, preferredProjectId));
      setWorkspace('folder');
      setCreating(false);
    }
    wasOpen.current = open;
  }, [open, preferredProjectId, projects]);

  const start = useCallback(async () => {
    if (project === undefined) return;
    const providerId = settings?.defaultProviderId;
    const modelId = settings?.defaultModelId;
    if (!providerId || !modelId) {
      toast.error('Set a default provider and model in Settings before creating a thread.');
      return;
    }

    setCreating(true);
    try {
      const thread = await rpc.request(
        'threads.create',
        buildCreateThreadParams({
          projectId: project.id,
          providerId,
          modelId,
          permissionMode: settings?.defaultPermissionMode ?? 'ask',
          workspace: effectiveWorkspace,
        }),
      );
      onOpenChange(false);
      onCreated(thread);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the thread.');
    } finally {
      setCreating(false);
    }
  }, [effectiveWorkspace, onCreated, onOpenChange, project, rpc, settings]);

  const close = useCallback(() => {
    if (!creating) onOpenChange(false);
  }, [creating, onOpenChange]);

  const projectOptions = useMemo(
    () => projects.map((entry) => ({ value: entry.id, label: entry.name })),
    [projects],
  );

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next && !creating) onOpenChange(false);
      }}
    >
      <DialogContent data-testid="new-thread-dialog">
        <DialogTitle>New chat</DialogTitle>
        {projects.length === 0 ? (
          <>
            <DialogDescription>
              A chat runs inside a project folder, so Tuffcode needs one first. Add a git repository
              and it becomes the workspace for this chat.
            </DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                data-testid="new-thread-add-project"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onAddProject();
                }}
              >
                Add project
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogDescription>
              Choose where this chat runs. Nothing is created until you start it.
            </DialogDescription>

            <div className="mt-4 flex flex-col gap-1.5">
              <label
                className="text-2xs font-medium text-muted-foreground"
                htmlFor="new-thread-project"
              >
                Project
              </label>
              <Select
                id="new-thread-project"
                aria-label="Project"
                options={projectOptions}
                value={selectedProjectId}
                onValueChange={(next) => setProjectId(next)}
              />
            </div>

            <div role="radiogroup" aria-label="Workspace" className="mt-4 flex flex-col gap-2">
              {choices.map((choice) => {
                const active = effectiveWorkspace === choice;
                const Icon = choice === 'worktree' ? FolderGit2 : Folder;
                return (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`workspace-${choice}`}
                    onClick={() => setWorkspace(choice)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                      active ? 'border-ring bg-accent' : 'border-border hover:bg-accent/60',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                        active ? 'border-ring' : 'border-muted-foreground/60',
                      )}
                    >
                      {active ? <span className="size-1.5 rounded-full bg-ring" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm text-foreground">
                        <Icon
                          aria-hidden="true"
                          strokeWidth={1.75}
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        {choice === 'worktree'
                          ? 'New worktree (isolated branch)'
                          : 'Current folder (no worktree)'}
                      </span>
                      <span className="text-2xs text-muted-foreground">
                        {workspaceConsequence(choice)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {worktreesEnabled ? null : (
              <p
                data-testid="workspace-folder-only"
                className="mt-3 text-2xs text-muted-foreground"
              >
                Worktrees are off, so folder mode is the only mode.
              </p>
            )}

            {project === undefined ? null : (
              <p
                data-testid="workspace-summary"
                className="mt-3 truncate font-mono text-2xs text-muted-foreground"
                title={workspaceSummary(project, effectiveWorkspace)}
              >
                {workspaceSummary(project, effectiveWorkspace)}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={creating} onClick={close}>
                Cancel
              </Button>
              <Button
                data-testid="new-thread-start"
                size="sm"
                disabled={creating || project === undefined}
                onClick={() => void start()}
              >
                {creating ? <Spinner size="sm" label="Creating thread" /> : null}
                {creating ? 'Creating' : 'Start'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </DialogRoot>
  );
}
