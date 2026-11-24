/**
 * Goal ids the inspector is tracking, remembered per thread for the session so
 * switching tabs or threads does not orphan a running council goal.
 */

const goalByThread = new Map<string, string>();

export function rememberedCouncilGoal(threadId: string): string | null {
  return goalByThread.get(threadId) ?? null;
}

export function rememberCouncilGoal(threadId: string, goalId: string): void {
  goalByThread.set(threadId, goalId);
}

export function forgetCouncilGoal(threadId: string): void {
  goalByThread.delete(threadId);
}
