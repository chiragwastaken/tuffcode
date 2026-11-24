import type { ApprovalChoice } from '@tuffcode/contracts';
import { useSyncExternalStore } from 'react';
import type { ApprovalDecisionMap, LocalUserMessage } from './grouping';

const EMPTY_MESSAGES: readonly LocalUserMessage[] = [];

const messagesByThread = new Map<string, LocalUserMessage[]>();
const approvals = new Map<string, ApprovalChoice>();
const listeners = new Set<() => void>();

let approvalSnapshot: ApprovalDecisionMap = {};
let approvalVersion = 0;
let approvalSnapshotVersion = -1;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

function updateMessage(
  messageId: string,
  patch: (message: LocalUserMessage) => LocalUserMessage,
): void {
  for (const [threadId, list] of messagesByThread) {
    const index = list.findIndex((message) => message.id === messageId);
    if (index === -1) continue;
    const current = list[index];
    if (!current) return;
    const next = list.slice();
    next[index] = patch(current);
    messagesByThread.set(threadId, next);
    emit();
    return;
  }
}

/** Session-local echo of a sent message; the event log has no user message row. */
export function addLocalUserMessage(message: LocalUserMessage): void {
  const list = messagesByThread.get(message.threadId) ?? [];
  messagesByThread.set(message.threadId, [...list, message]);
  emit();
}

/** The server accepted the send: the echo now carries the turn it started. */
export function resolveLocalUserMessage(messageId: string, turnId: string): void {
  updateMessage(messageId, (message) => ({ ...message, turnId, status: 'sent' }));
}

/** The send RPC rejected: keep the text so the bubble can offer a retry. */
export function failLocalUserMessage(messageId: string): void {
  updateMessage(messageId, (message) => ({ ...message, status: 'failed' }));
}

/** A retry is in flight again. */
export function retryLocalUserMessage(messageId: string): void {
  updateMessage(messageId, (message) => ({ ...message, status: 'pending' }));
}

/**
 * Drops echoes whose turn now has a persisted row. Pending echoes are kept
 * because a new send can share text with an older row.
 */
export function pruneResolvedLocalUserMessages(
  threadId: string,
  turnIds: ReadonlySet<string>,
): void {
  if (turnIds.size === 0) return;
  const list = messagesByThread.get(threadId);
  if (list === undefined) return;
  const kept = list.filter((message) => message.turnId === null || !turnIds.has(message.turnId));
  if (kept.length === list.length) return;
  messagesByThread.set(threadId, kept);
  emit();
}

export function localUserMessages(threadId: string): readonly LocalUserMessage[] {
  return messagesByThread.get(threadId) ?? EMPTY_MESSAGES;
}

export function setApprovalDecision(approvalId: string, decision: ApprovalChoice): void {
  if (approvals.get(approvalId) === decision) return;
  approvals.set(approvalId, decision);
  approvalVersion += 1;
  emit();
}

export function useLocalUserMessages(threadId: string): readonly LocalUserMessage[] {
  return useSyncExternalStore(subscribe, () => localUserMessages(threadId));
}

function getApprovalSnapshot(): ApprovalDecisionMap {
  if (approvalSnapshotVersion !== approvalVersion) {
    approvalSnapshot = Object.fromEntries(approvals);
    approvalSnapshotVersion = approvalVersion;
  }
  return approvalSnapshot;
}

export function useApprovalDecisions(): ApprovalDecisionMap {
  return useSyncExternalStore(subscribe, getApprovalSnapshot);
}
