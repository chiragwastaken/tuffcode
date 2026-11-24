import type { RpcResult } from '@tuffcode/contracts';

export type LatestCouncil = RpcResult<'council.latest'>;

/**
 * The goal a mounted panel or composer follows after a reload: the thread's newest
 * goal from the server, unless the user dismissed exactly that goal in this session.
 * A dismissed goal stays hidden until a newer one replaces it.
 */
export function goalIdFromLatest(
  latest: LatestCouncil,
  dismissedGoalId: string | null,
): string | null {
  if (latest === null) return null;
  return latest.goal.id === dismissedGoalId ? null : latest.goal.id;
}
