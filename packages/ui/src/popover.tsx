import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const PopoverRoot = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverClose = BasePopover.Close;

export type PopoverContentProps = Omit<
  ComponentProps<typeof BasePopover.Popup>,
  'className' | 'side' | 'align' | 'sideOffset'
> & {
  className?: string;
  side?: ComponentProps<typeof BasePopover.Positioner>['side'];
  align?: ComponentProps<typeof BasePopover.Positioner>['align'];
  sideOffset?: number;
};

export function PopoverContent({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-50 outline-none"
      >
        <BasePopover.Popup
          className={cn(
            'min-w-56 rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground',
            'outline-none',
            'transition-opacity duration-150 ease-out',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
