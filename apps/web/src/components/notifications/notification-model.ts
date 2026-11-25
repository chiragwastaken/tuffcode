import type { NotificationSettings, ServerEvent, Thread, ThreadStatus } from '@tuffcode/contracts';
import type { NotifyRequest } from '../../types';

/**
 * Which server events become a desktop notification. Pure, so the rules are tested
 * without a bridge: a turn that finished or failed, an approval waiting, a subagent
 * that settled, and a council task that needs the captain.
 */
export interface NotificationContext {
  settings: NotificationSettings;
  threads: Readonly<Record<string, Thread>>;
  /** The status each thread had before this event, kept by the caller. */
  previousStatus: ReadonlyMap<string, ThreadStatus>;
}

function threadRoute(thread: Thread): string {
  return `/project/${thread.projectId}/thread/${thread.id}`;
}

function shortTitle(thread: Thread | undefined): string {
  const title = thread?.title.trim() ?? '';
  return title.length > 0 ? title : 'A chat';
}

export function notificationFor(event: ServerEvent, context: NotificationContext): NotifyRequest | null {
  const { settings } = context;
  const silent = !settings.sound;
  switch (event.type) {
    case 'thread.updated': {
      const thread = event.payload;
      // Child threads report through their parent's subagent notification instead.
      if (thread.parentThreadId !== null) return null;
      const before = context.previousStatus.get(thread.id);
      if (before !== 'running' && before !== 'needs-approval') return null;
      if (!settings.turnFinished) return null;
      if (thread.status === 'ready-to-review' || thread.status === 'idle') {
        return { title: 'Turn finished', body: shortTitle(thread), route: threadRoute(thread), silent };
      }
      if (thread.status === 'failed') {
        return { title: 'Turn failed', body: shortTitle(thread), route: threadRoute(thread), silent };
      }
      return null;
    }
    case 'approval.requested': {
      if (!settings.approvalNeeded) return null;
      const thread = context.threads[event.payload.threadId];
      return {
        title: 'Approval needed',
        body: `${shortTitle(thread)}: ${event.payload.toolName}`,
        ...(thread === undefined ? {} : { route: threadRoute(thread) }),
        silent,
      };
    }
    case 'subagent.finished': {
      if (!settings.subagentFinished) return null;
      const thread = context.threads[event.payload.threadId];
      const outcome =
        event.payload.status === 'done' ? 'finished' : event.payload.status === 'cancelled' ? 'was stopped' : 'failed';
      return {
        title: `Subagent ${outcome}`,
        body: shortTitle(thread),
        ...(thread === undefined ? {} : { route: threadRoute(thread) }),
        silent,
      };
    }
    case 'council.updated': {
      if (!settings.councilEscalation) return null;
      if (event.payload.state !== 'reviewing' && event.payload.state !== 'failed') return null;
      const thread = event.threadId === undefined ? undefined : context.threads[event.threadId];
      if (event.payload.state === 'failed') {
        return {
          title: 'Council goal failed',
          body: shortTitle(thread),
          ...(thread === undefined ? {} : { route: threadRoute(thread) }),
          silent,
        };
      }
      return null;
    }
    default:
      return null;
  }
}
