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

/** Session-local echo of sent messages; the event log has no user message row. */
export function addLocalUserMessage(message: LocalUserMessage): void {
  const list = messagesByThread.get(message.threadId) ?? [];
  messagesByThread.set(message.threadId, [...list, message]);
  emit();
}

export function setApprovalDecision(approvalId: string, decision: ApprovalChoice): void {
  if (approvals.get(approvalId) === decision) return;
  approvals.set(approvalId, decision);
  approvalVersion += 1;
  emit();
}

export function useLocalUserMessages(threadId: string): readonly LocalUserMessage[] {
  return useSyncExternalStore(subscribe, () => messagesByThread.get(threadId) ?? EMPTY_MESSAGES);
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
