import { describe, expect, it } from 'vitest';
import { packagedUpdateCheck } from './updates-check';

describe('packagedUpdateCheck', () => {
  it('reports the packaged result without inventing an endpoint', () => {
    const result = packagedUpdateCheck({
      version: '0.1.0',
      channel: 'beta',
      now: new Date('2026-11-24T10:00:00.000Z'),
    });

    expect(result).toEqual({
      status: 'unavailable',
      version: '0.1.0',
      channel: 'beta',
      checkedAt: '2026-11-24T10:00:00.000Z',
      detail:
        'No update feed is configured for this build. Packaged builds check the beta channel at launch.',
    });
  });

  it('names the channel that would be checked', () => {
    const stable = packagedUpdateCheck({ version: '0.1.0', channel: 'stable' });
    expect(stable.detail).toContain('stable');
    expect(Number.isNaN(Date.parse(stable.checkedAt))).toBe(false);
  });
});
