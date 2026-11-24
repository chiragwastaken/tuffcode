import { IconButton, cn } from '@tuffcode/ui';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ACTIONS,
  actionUnavailableReason,
  runAction,
  type ActionContext,
  type ActionId,
} from '../actions';

export interface MessageActionsProps {
  items: readonly ActionId[];
  context: ActionContext;
  className?: string;
}

/**
 * Hover toolbar for one message. It is absolutely positioned inside the
 * message's relative wrapper, so revealing it never moves the text.
 */
export function MessageActions({ items, context, className }: MessageActionsProps) {
  const [copied, setCopied] = useState<ActionId | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
    },
    [],
  );

  function run(id: ActionId): void {
    void Promise.resolve(runAction(id, context)).then(
      () => {
        if (id !== 'message.copy' && id !== 'message.copyMarkdown') return;
        setCopied(id);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(null), 1200);
      },
      (error: unknown) => {
        context.notify.error(error instanceof Error ? error.message : 'That action failed.');
      },
    );
  }

  return (
    <div
      data-testid="message-actions"
      className={cn(
        'pointer-events-none absolute -top-3 right-0 z-10 flex items-center gap-0.5',
        'rounded-md border border-border bg-popover p-0.5 opacity-0 shadow-sm',
        'transition-opacity duration-150 ease-out',
        'group-hover:pointer-events-auto group-hover:opacity-100',
        'focus-within:pointer-events-auto focus-within:opacity-100',
        className,
      )}
    >
      {items.map((id) => {
        const action = ACTIONS[id];
        const reason = actionUnavailableReason(id, context);
        return (
          <IconButton
            key={id}
            icon={copied === id ? Check : action.icon}
            label={action.label}
            size="sm"
            disabled={reason !== null}
            data-testid={`message-action-${id}`}
            onClick={() => run(id)}
            className="size-6 [&_svg]:size-3"
          />
        );
      })}
    </div>
  );
}
