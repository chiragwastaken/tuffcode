import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const DialogRoot = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export type DialogContentProps = Omit<ComponentProps<typeof BaseDialog.Popup>, 'className'> & {
  className?: string;
};

/** Portal, backdrop, and popup in one piece; place title and body as children. */
export function DialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          'fixed inset-0 z-40 bg-overlay',
          'transition-opacity duration-150 ease-out',
          'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        )}
      />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
        <BaseDialog.Popup
          className={cn(
            'w-full max-w-md rounded-lg border border-border bg-popover p-5 text-popover-foreground',
            'outline-none',
            'transition-opacity duration-150 ease-out',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

export type DialogTitleProps = Omit<ComponentProps<typeof BaseDialog.Title>, 'className'> & {
  className?: string;
};

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export type DialogDescriptionProps = Omit<
  ComponentProps<typeof BaseDialog.Description>,
  'className'
> & {
  className?: string;
};

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <BaseDialog.Description
      className={cn('mt-1 text-xs leading-5 text-muted-foreground', className)}
      {...props}
    />
  );
}
