import { Button, Spinner } from '@tuffcode/ui';
import { ArrowUp } from 'lucide-react';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

/** Four lines of 24px leading plus the 12px padding the box reserves. */
const MIN_HEIGHT = 4 * 24;
const MAX_HEIGHT = 240;

export interface CouncilGoalProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  starting: boolean;
  canSend: boolean;
  disabled: boolean;
}

/**
 * Council mode's only input: one goal box. There is no model chip and no
 * permission control because the council reads both from settings.
 */
export function CouncilGoal({
  value,
  onChange,
  onSend,
  starting,
  canSend,
  disabled,
}: CouncilGoalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(Math.max(element.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) return;
    const sends = event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey);
    if (!sends) return;
    event.preventDefault();
    onSend();
  }

  return (
    <div className="flex flex-col gap-2 px-1 py-1">
      <label htmlFor="council-goal" className="text-xs font-medium text-foreground">
        What should the council build?
      </label>
      <textarea
        ref={textareaRef}
        id="council-goal"
        data-testid="council-goal-input"
        value={value}
        rows={4}
        disabled={disabled}
        placeholder="Describe the change the council should plan, build and review."
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full resize-none overflow-y-auto bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-64"
        style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
      />
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 text-2xs leading-4 text-muted-foreground">
          The council plans, runs parallel workers, and reviews each change.
        </p>
        <Button
          data-testid="council-send"
          size="sm"
          variant="primary"
          disabled={!canSend}
          onClick={onSend}
        >
          {starting ? (
            <Spinner size="sm" label="Starting council" />
          ) : (
            <ArrowUp strokeWidth={1.75} />
          )}
          Send
        </Button>
      </div>
    </div>
  );
}
