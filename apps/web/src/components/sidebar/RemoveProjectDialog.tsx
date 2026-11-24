import type { Project } from '@tuffcode/contracts';
import { Button, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '@tuffcode/ui';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

export interface RemoveProjectDialogProps {
  /** Null keeps the dialog closed; setting a project opens it. */
  project: Project | null;
  threadCount: number;
  onClose: () => void;
  onRemoved: (project: Project) => void;
}

export function RemoveProjectDialog({
  project,
  threadCount,
  onClose,
  onRemoved,
}: RemoveProjectDialogProps) {
  const rpc = useRpc();
  const removeProject = useAppStore((state) => state.removeProject);
  const [removing, setRemoving] = useState(false);

  const confirm = useCallback(async () => {
    if (!project) return;

    setRemoving(true);
    try {
      await rpc.request('projects.remove', { id: project.id, deleteWorktrees: false });
      removeProject(project.id);
      toast.success(`Removed ${project.name}`);
      onRemoved(project);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the project.');
    } finally {
      setRemoving(false);
    }
  }, [onClose, onRemoved, project, removeProject, rpc]);

  const threadLabel = threadCount === 1 ? 'thread' : 'threads';

  return (
    <DialogRoot
      open={project !== null}
      onOpenChange={(open) => {
        if (!open && !removing) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Remove {project?.name ?? 'project'}?</DialogTitle>
        <DialogDescription>
          {threadCount === 0
            ? 'This removes the project from Tuffcode. Files on disk stay where they are.'
            : `This removes the project and its ${threadCount} ${threadLabel} from Tuffcode. Files and worktrees on disk stay where they are.`}
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={removing} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={removing} onClick={() => void confirm()}>
            {removing ? 'Removing' : 'Remove project'}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
