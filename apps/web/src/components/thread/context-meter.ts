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
