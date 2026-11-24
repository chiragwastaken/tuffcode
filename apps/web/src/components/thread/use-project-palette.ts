import type { Command, Skill } from '@tuffcode/contracts';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { RpcClient } from '../../rpc/client';
import { useRpc } from '../../rpc/rpc-context';

export interface PaletteData {
  commands: Command[];
  skills: Skill[];
}

const EMPTY: PaletteData = { commands: [], skills: [] };
const cache = new Map<string, Promise<PaletteData>>();

function load(rpc: RpcClient, projectId: string): Promise<PaletteData> {
  let pending = cache.get(projectId);
  if (!pending) {
    pending = Promise.all([
      rpc.request('commands.list', { projectId }),
      rpc.request('skills.list', { projectId }),
    ]).then(([commands, skills]) => ({ commands, skills }));
    cache.set(projectId, pending);
    void pending.catch(() => cache.delete(projectId));
  }
  return pending;
}

/**
 * Commands and skills load the first time a palette trigger appears, not on every
 * thread mount, so a provider without those RPCs stays quiet until asked.
 */
export function useProjectPalette(projectId: string | undefined, enabled: boolean): PaletteData {
  const rpc = useRpc();
  const [data, setData] = useState<PaletteData>(EMPTY);

  useEffect(() => {
    if (!projectId || !enabled) return;
    let cancelled = false;
    load(rpc, projectId).then(
      (loaded) => {
        if (!cancelled) setData(loaded);
      },
      (error: unknown) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : 'Could not load commands and skills.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, rpc]);

  return data;
}
