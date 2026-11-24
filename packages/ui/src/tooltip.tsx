import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/** Optional: wrap a subtree to share open and close delays across tooltips. */
export const TooltipProvider = BaseTooltip.Provider;
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

export type TooltipContentProps = Omit<ComponentProps<typeof BaseTooltip.Popup>, 'className'> & {
  className?: string;
  side?: ComponentProps<typeof BaseTooltip.Positioner>['side'];
  align?: ComponentProps<typeof BaseTooltip.Positioner>['align'];
  sideOffset?: number;
};

export function TooltipContent({
  className,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  ...props
}: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-50 outline-none"
      >
        <BaseTooltip.Popup
          className={cn(
            'max-w-64 rounded-sm border border-border bg-popover px-2 py-1 text-2xs leading-4 text-popover-foreground',
            'outline-none',
            'transition-opacity duration-150 ease-out',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}
