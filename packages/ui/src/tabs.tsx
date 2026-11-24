import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { focusRing } from './states';

export const TabsRoot = BaseTabs.Root;
export const TabsPanel = BaseTabs.Panel;

export type TabsListProps = Omit<ComponentProps<typeof BaseTabs.List>, 'className'> & {
  className?: string;
};

export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
      {...props}
    />
  );
}

export type TabsTabProps = Omit<ComponentProps<typeof BaseTabs.Tab>, 'className'> & {
  className?: string;
};

export function TabsTab({ className, ...props }: TabsTabProps) {
  return (
    <BaseTabs.Tab
      className={cn(
        'inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-medium text-muted-foreground',
        'transition-colors duration-150 ease-out hover:text-foreground',
        'data-[active]:bg-surface-raised data-[active]:text-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-64',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
