import { cn } from '@tuffcode/ui';

export interface SettingsSliderProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown next to the track, e.g. `px` or `iterations`. */
  unit?: string;
  disabled?: boolean;
  onChange(value: number): void;
}

/** A native range input with the current value spelled out beside it. */
export function SettingsSlider({
  id,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onChange,
}: SettingsSliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          'h-9 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent',
          '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-border',
          '[&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      />
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {value}
        {unit ? ` ${unit}` : null}
      </span>
    </div>
  );
}
