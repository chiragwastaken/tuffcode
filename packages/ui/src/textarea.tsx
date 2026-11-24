import type { ComponentProps } from 'react';
import { cn } from './cn';
import { disabledState } from './states';

export type TextareaProps = ComponentProps<'textarea'> & {
  className?: string;
};

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'aria-invalid:border-error aria-invalid:focus-visible:ring-error',
        disabledState,
        className,
      )}
      {...props}
    />
  );
}
