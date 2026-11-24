import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { Button, type ButtonProps } from './button';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size'> {
  /** Icon rendered at stroke width 1.75. */
  icon: LucideIcon;
  /** Accessible name; also used as the native tooltip. */
  label: string;
  size?: 'sm' | 'md';
}

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  variant = 'ghost',
  className,
  ...props
}: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size === 'sm' ? 'icon-sm' : 'icon'}
      className={cn(size === 'sm' ? '[&_svg]:size-3.5' : '[&_svg]:size-4', className)}
      {...props}
    >
      <Icon strokeWidth={1.75} />
    </Button>
  );
}
