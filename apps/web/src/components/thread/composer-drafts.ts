/**
 * Text another surface wants in a thread's composer the next time it mounts, such as
 * the skill-authoring request "Create with AI" opens a new chat with. Consumed once.
 */
const pending = new Map<string, string>();

export function setPendingDraft(threadId: string, text: string): void {
  pending.set(threadId, text);
}

export function takePendingDraft(threadId: string | undefined): string | null {
  if (threadId === undefined) return null;
  const text = pending.get(threadId) ?? null;
  pending.delete(threadId);
  return text;
}
