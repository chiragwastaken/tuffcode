import { describe, expect, it } from 'vitest';
import {
  CONTEXT_BAR_MIN_WIDTH_PX,
  CONTEXT_BAR_TONE_CLASS,
  CONTEXT_METER_TONE_CLASS,
  barWidthPercent,
  contextBarTone,
  contextMeterTone,
  contextTokenLine,
  contextTooltip,
  formatPercent,
  formatSegmentPercent,
  formatTokenCount,
  isContextWarning,
  limitSourceLabel,
  segmentPercent,
  usagePercent,
  type ContextUsage,
} from './context-meter';

function usage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    usedTokens: 42_000,
    maxTokens: 200_000,
    percent: 0.21,
    limitSource: 'model',
    segments: [
      { name: 'system', tokens: 640 },
      { name: 'messages', tokens: 41_360 },
    ],
    ...overrides,
  };
}

describe('context meter percent', () => {
  it('computes the share from the token totals', () => {
    expect(usagePercent(usage())).toBeCloseTo(0.21);
    expect(usagePercent({ usedTokens: 0, maxTokens: 200_000 })).toBe(0);
    expect(usagePercent({ usedTokens: 250_000, maxTokens: 200_000 })).toBe(1);
    expect(usagePercent({ usedTokens: 10, maxTokens: 0 })).toBe(0);
  });

  it('formats the chip percent', () => {
    expect(formatPercent(0.21)).toBe('21%');
    expect(formatPercent(0.005)).toBe('1%');
    expect(formatPercent(1.4)).toBe('100%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('formats token counts for the tooltip and rows', () => {
    expect(formatTokenCount(819)).toBe('819');
    expect(formatTokenCount(42_000)).toBe('42k');
    expect(formatTokenCount(200_000)).toBe('200k');
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_250_000)).toBe('1.3M');
  });
});

describe('context warning color', () => {
  it('warns at or above the threshold, not below it', () => {
    expect(isContextWarning(0.79, 0.8)).toBe(false);
    expect(isContextWarning(0.8, 0.8)).toBe(true);
    expect(isContextWarning(0.95, 0.8)).toBe(true);
  });

  it('maps the tone to the meter classes', () => {
    expect(contextMeterTone(0.4, 0.8)).toBe('default');
    expect(contextMeterTone(0.8, 0.8)).toBe('warning');
    expect(CONTEXT_METER_TONE_CLASS.warning).toContain('text-warning');
    expect(CONTEXT_METER_TONE_CLASS.default).toContain('text-muted');
  });

  it('clamps nonsense thresholds instead of warning everything', () => {
    expect(isContextWarning(0.5, Number.NaN)).toBe(false);
    expect(isContextWarning(Number.NaN, 0.8)).toBe(false);
  });
});

describe('context tooltip and segments', () => {
  it('names the totals and every segment', () => {
    const text = contextTooltip(usage());
    expect(text).toContain('42k of 200k tokens (21%)');
    expect(text).toContain('system 640');
    expect(text).toContain('messages 41k');
  });

  it('omits the segment line when the server reported none', () => {
    expect(contextTooltip(usage({ segments: [] }))).toBe(
      '42k of 200k tokens (21%)\nLimit source: model',
    );
  });

  it('computes each segment share of the window', () => {
    expect(segmentPercent(20_000, 200_000)).toBeCloseTo(0.1);
    expect(segmentPercent(300_000, 200_000)).toBe(1);
    expect(segmentPercent(10, 0)).toBe(0);
  });

  it('keeps one decimal for segments below 10%', () => {
    expect(formatSegmentPercent(segmentPercent(130, 33_000))).toBe('0.4%');
    expect(formatSegmentPercent(segmentPercent(49, 33_000))).toBe('0.1%');
    expect(formatSegmentPercent(segmentPercent(750, 33_000))).toBe('2.3%');
    expect(formatSegmentPercent(segmentPercent(20_000, 200_000))).toBe('10%');
    expect(formatSegmentPercent(segmentPercent(0, 33_000))).toBe('0%');
    expect(formatSegmentPercent(0.0001)).toBe('<0.1%');
  });
});

describe('context limit source', () => {
  it('names every precedence step', () => {
    expect(limitSourceLabel('model')).toBe('model');
    expect(limitSourceLabel('config')).toBe('provider config');
    expect(limitSourceLabel('settings')).toBe('settings');
    expect(limitSourceLabel('default')).toBe('assumed default');
  });

  it('reads a server that sends no source as the model window', () => {
    expect(limitSourceLabel(undefined)).toBe('model');
  });

  it('spells the assumption out on the token line only for a defaulted window', () => {
    expect(contextTokenLine(usage({ limitSource: 'default' }))).toBe(
      '42k of 200k tokens (assumed default)',
    );
    expect(contextTokenLine(usage({ limitSource: 'model' }))).toBe('42k of 200k tokens');
    expect(contextTokenLine(usage({ limitSource: 'config' }))).toBe('42k of 200k tokens');
    expect(contextTokenLine(usage({ limitSource: 'settings' }))).toBe('42k of 200k tokens');
    expect(contextTokenLine(usage({ limitSource: undefined }))).toBe('42k of 200k tokens');
  });

  it('keeps the source in the tooltip for every step', () => {
    expect(contextTooltip(usage({ limitSource: 'default' }))).toContain(
      'Limit source: assumed default',
    );
    expect(contextTooltip(usage({ limitSource: 'config' }))).toContain(
      'Limit source: provider config',
    );
    expect(contextTooltip(usage({ limitSource: 'settings' }))).toContain('Limit source: settings');
    expect(contextTooltip(usage({ limitSource: undefined }))).toContain('Limit source: model');
  });
});

describe('context bar fill', () => {
  it('picks a subdued tone for a nearly empty window', () => {
    expect(contextBarTone(0.04, 0.8)).toBe('low');
    expect(contextBarTone(0.21, 0.8)).toBe('default');
    expect(contextBarTone(0.8, 0.8)).toBe('warning');
    expect(CONTEXT_BAR_TONE_CLASS.low).toContain('bg-muted-foreground');
    expect(CONTEXT_BAR_TONE_CLASS.default).toContain('bg-primary');
    expect(CONTEXT_BAR_TONE_CLASS.warning).toContain('bg-warning');
  });

  it('maps the share to a clamped fill width', () => {
    expect(barWidthPercent(0.04)).toBeCloseTo(4);
    expect(barWidthPercent(1.4)).toBe(100);
    expect(barWidthPercent(Number.NaN)).toBe(0);
    expect(CONTEXT_BAR_MIN_WIDTH_PX).toBeGreaterThan(0);
  });
});
