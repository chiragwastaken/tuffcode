import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../rpc/rpc-context';
import { useAppStore } from '../store/app-store';

export function useAddProject() {
  const rpc = useRpc();
  const upsertProject = useAppStore((state) => state.upsertProject);
  const [adding, setAdding] = useState(false);

  const addProject = useCallback(async () => {
    const path = await window.tuffcode.pickFolder();
    if (!path) return;

    setAdding(true);
    try {
      const project = await rpc.request('projects.add', { path });
      upsertProject(project);
      toast.success(`Added ${project.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the project.');
    } finally {
      setAdding(false);
    }
  }, [rpc, upsertProject]);

  return { addProject, adding };
}
