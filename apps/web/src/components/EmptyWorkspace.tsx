import { Button, EmptyState } from '@tuffcode/ui';
import { FolderOpen, FolderPlus } from 'lucide-react';
import { useAddProject } from '../hooks/use-add-project';

export function EmptyWorkspace() {
  const { addProject, adding } = useAddProject();

  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={FolderOpen}
        title="No projects yet"
        description="Add a local repository to get started. Tuffcode gives every thread its own git worktree, so your main checkout stays untouched."
        action={
          <Button onClick={addProject} disabled={adding}>
            <FolderPlus strokeWidth={1.75} />
            Add project
          </Button>
        }
        className="w-full max-w-md"
      />
    </div>
  );
}
