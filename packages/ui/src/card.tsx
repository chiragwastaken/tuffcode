import type { ComponentProps } from 'react';
import { cn } from './cn';

export type CardProps = ComponentProps<'div'> & { className?: string };

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card text-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return <div className={cn('flex flex-col gap-1 p-3', className)} {...props} />;
}

export type CardTitleProps = ComponentProps<'h3'> & { className?: string };

export function CardTitle({ className, ...props }: CardTitleProps) {
  return <h3 className={cn('text-sm font-semibold text-foreground', className)} {...props} />;
}

export type CardDescriptionProps = ComponentProps<'p'> & { className?: string };

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return <p className={cn('text-xs leading-5 text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={cn('px-3 pb-3', className)} {...props} />;
}

export function CardFooter({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-border px-3 py-2', className)}
      {...props}
    />
  );
}
