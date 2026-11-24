import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export interface ScrollAreaProps extends Omit<
  ComponentProps<typeof BaseScrollArea.Root>,
  'className' | 'children'
> {
  className?: string;
  viewportClassName?: string;
  children?: ReactNode;
}

export function ScrollArea({ className, viewportClassName, children, ...props }: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root className={cn('relative overflow-hidden', className)} {...props}>
      <BaseScrollArea.Viewport className={cn('size-full', viewportClassName)}>
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="absolute top-0 right-0 flex w-2 touch-none p-0.5 select-none"
      >
        <BaseScrollArea.Thumb className="flex-1 rounded-full bg-border" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className="absolute right-0 bottom-0 left-0 flex h-2 touch-none p-0.5 select-none"
      >
        <BaseScrollArea.Thumb className="flex-1 rounded-full bg-border" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  );
}
