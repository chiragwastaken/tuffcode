import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { disabledState, focusRing } from './states';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select an option',
  disabled,
  className,
  id,
  name,
  'aria-label': ariaLabel,
}: SelectProps) {
  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next)}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      disabled={disabled}
      name={name}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground',
          'hover:bg-accent data-[popup-open]:bg-accent',
          focusRing,
          disabledState,
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} className="truncate text-left" />
        <BaseSelect.Icon>
          <ChevronDown strokeWidth={1.75} className="size-4 shrink-0 text-muted-foreground" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50 outline-none">
          <BaseSelect.Popup
            className={cn(
              'max-h-64 min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground',
              'outline-none',
            )}
          >
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    'flex h-8 cursor-default items-center justify-between gap-2 rounded-sm px-2 text-sm text-foreground outline-none',
                    'data-[highlighted]:bg-accent data-[disabled]:opacity-64',
                  )}
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <Check strokeWidth={1.75} className="size-3.5 text-foreground" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
