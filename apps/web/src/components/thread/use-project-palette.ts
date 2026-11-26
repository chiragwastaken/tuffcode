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
/** Mounted palettes re-read after an invalidation; the cache itself is shared. */
const refreshListeners = new Set<() => void>();
let bound: Pick<RpcClient, 'onEvent'> | null = null;
let unbind: (() => void) | null = null;

/** Drops every project's cached palette so the next open refetches. */
export function invalidatePaletteCache(): void {
  cache.clear();
  for (const listener of refreshListeners) listener();
}

/**
 * One subscription per client for the life of the app, so a discovery event clears the
 * cache even while no palette is open and a stale list cannot survive `/reload`.
 */
export function bindPaletteInvalidation(client: Pick<RpcClient, 'onEvent'>): void {
  if (bound === client) return;
  unbind?.();
  bound = client;
  unbind = client.onEvent((event) => {
    if (
      event.type === 'commands.updated' ||
      event.type === 'skills.updated' ||
      event.type === 'plugins.updated'
    ) {
      invalidatePaletteCache();
    }
  });
}

/** Reads the palette once per project; the promise is shared until invalidated. */
export function loadPalette(rpc: RpcClient, projectId: string): Promise<PaletteData> {
  const cached = cache.get(projectId);
  if (cached !== undefined) return cached;
  const pending = Promise.all([
    rpc.request('commands.list', { projectId }),
    rpc.request('skills.list', { projectId }),
  ]).then(([commands, skills]) => ({ commands, skills }));
  cache.set(projectId, pending);
  void pending.catch(() => cache.delete(projectId));
  return pending;
}

/**
 * Commands and skills load the first time a palette trigger appears, not on every
 * thread mount, so a provider without those RPCs stays quiet until asked. A
 * `commands.updated`, `skills.updated` or `plugins.updated` frame drops the cache and
 * an open palette refetches.
 */
export function useProjectPalette(projectId: string | undefined, enabled: boolean): PaletteData {
  const rpc = useRpc();
  const [data, setData] = useState<PaletteData>(EMPTY);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    bindPaletteInvalidation(rpc);
  }, [rpc]);

  useEffect(() => {
    const listener = () => setVersion((previous) => previous + 1);
    refreshListeners.add(listener);
    return () => {
      refreshListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!projectId || !enabled) return;
    let cancelled = false;
    loadPalette(rpc, projectId).then(
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
  }, [enabled, projectId, rpc, version]);

  return data;
}
