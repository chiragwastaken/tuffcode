import { Input as BaseInput } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { disabledState } from './states';

export type InputProps = Omit<ComponentProps<typeof BaseInput>, 'className'> & {
  className?: string;
};

export function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground',
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
