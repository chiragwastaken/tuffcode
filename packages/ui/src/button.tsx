import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { disabledState, focusRing } from './states';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium',
    'transition-colors duration-150 ease-out',
    focusRing,
    disabledState,
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-foreground hover:bg-accent',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        danger: 'bg-error text-primary-foreground hover:bg-error/90',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9 px-3 text-sm',
        lg: 'h-10 px-4 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export type ButtonProps = Omit<ComponentProps<typeof BaseButton>, 'className'> &
  ButtonVariantProps & {
    className?: string;
  };

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <BaseButton
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
