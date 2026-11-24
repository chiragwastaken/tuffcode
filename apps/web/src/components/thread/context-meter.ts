/** Matches the settings default, so a meter rendered before settings load still warns. */
export const DEFAULT_CONTEXT_WARNING_THRESHOLD = 0.8;

export interface ContextSegment {
  name: string;
  tokens: number;
}

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  segments: ContextSegment[];
  compactedAt?: string;
}

export const CONTEXT_METER_TONE_CLASS = {
  default: 'text-muted-foreground',
  warning: 'text-warning-foreground',
} as const;

export type ContextMeterTone = keyof typeof CONTEXT_METER_TONE_CLASS;

/**
 * Below this share a rounded percentage prints `0%`, which reads as "nothing" for
 * a segment that still carries tokens. Segment rows switch to one decimal here.
 */
export const CONTEXT_LOW_USAGE_PERCENT = 0.1;

/** A 32px chip track draws 4% as 1.3px; the fill never shrinks below this nub. */
export const CONTEXT_BAR_MIN_WIDTH_PX = 3;

export const CONTEXT_BAR_TONE_CLASS = {
  low: 'bg-muted-foreground/60',
  default: 'bg-primary',
  warning: 'bg-warning',
} as const;

export type ContextBarTone = keyof typeof CONTEXT_BAR_TONE_CLASS;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function usagePercent(usage: Pick<ContextUsage, 'usedTokens' | 'maxTokens'>): number {
  if (usage.maxTokens <= 0) return 0;
  return clampPercent(usage.usedTokens / usage.maxTokens);
}

export function isContextWarning(percent: number, threshold: number): boolean {
  if (!Number.isFinite(threshold)) return false;
  return clampPercent(percent) >= clampPercent(threshold);
}

export function contextMeterTone(percent: number, threshold: number): ContextMeterTone {
  return isContextWarning(percent, threshold) ? 'warning' : 'default';
}

/**
 * The bar fill carries its own tone: a nearly empty window paints a subdued grey
 * nub instead of a full-strength accent sliver, so 4% cannot look like a glitch.
 */
export function contextBarTone(percent: number, threshold: number): ContextBarTone {
  if (isContextWarning(percent, threshold)) return 'warning';
  return clampPercent(percent) < CONTEXT_LOW_USAGE_PERCENT ? 'low' : 'default';
}

/** Fill width in percent; pair it with `CONTEXT_BAR_MIN_WIDTH_PX` for the nub. */
export function barWidthPercent(percent: number): number {
  return clampPercent(percent) * 100;
}

/** `200k`, `1.2M`, `819`: short enough for the chip and the segment rows. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function formatPercent(percent: number): string {
  return `${Math.round(clampPercent(percent) * 100)}%`;
}

/**
 * Segment rows keep one decimal below 10%: 130 of 33k tokens is 0.4%, and the
 * integer formatter would print the same `0%` for every small section.
 */
export function formatSegmentPercent(percent: number): string {
  const clamped = clampPercent(percent);
  if (clamped === 0) return '0%';
  if (clamped < 0.0005) return '<0.1%';
  if (clamped < CONTEXT_LOW_USAGE_PERCENT) return `${(clamped * 100).toFixed(1)}%`;
  return formatPercent(clamped);
}

/** One tooltip line for the total and one for the segments. */
export function contextTooltip(usage: ContextUsage): string {
  const head = `${formatTokenCount(usage.usedTokens)} of ${formatTokenCount(usage.maxTokens)} tokens (${formatPercent(usagePercent(usage))})`;
  if (usage.segments.length === 0) return head;
  const segments = usage.segments
    .map((segment) => `${segment.name} ${formatTokenCount(segment.tokens)}`)
    .join(' · ');
  return `${head}\n${segments}`;
}

export function segmentPercent(tokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return clampPercent(tokens / maxTokens);
}
