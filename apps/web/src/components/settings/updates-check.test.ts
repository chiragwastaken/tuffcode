import { describe, expect, it } from 'vitest';
import type { UpdateCheckOutcome } from '../../types';
import { checkForUpdatesNow, describeUpdateOutcome } from './updates-check';

const CHECKED_AT = '2026-11-25T10:00:00.000Z';

function outcome(overrides: Partial<UpdateCheckOutcome> = {}): UpdateCheckOutcome {
  return {
    status: 'available',
    version: '0.1.4',
    detail: 'Tuffcode 0.1.4 is available.',
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

describe('checkForUpdatesNow', () => {
  it('returns the bridge outcome unchanged when the preload exposes a check', async () => {
    const fromBridge = outcome({ status: 'current', detail: 'Tuffcode 0.1.3 is up to date.' });
    const result = await checkForUpdatesNow({
      bridge: { checkForUpdates: async () => fromBridge },
    });

    expect(result).toBe(fromBridge);
  });

  it('reports unavailable when the preload has no check', async () => {
    const result = await checkForUpdatesNow({
      now: new Date(CHECKED_AT),
    });

    expect(result).toEqual({
      status: 'unavailable',
      version: null,
      detail: 'Updates run in packaged builds. This build has no update feed.',
      checkedAt: CHECKED_AT,
    });
  });

  it('reports unavailable when the bridge object exists without the method', async () => {
    const result = await checkForUpdatesNow({
      bridge: {},
      now: new Date(CHECKED_AT),
    });

    expect(result.status).toBe('unavailable');
    expect(result.checkedAt).toBe(CHECKED_AT);
  });

  it('turns a rejected bridge call into an error outcome', async () => {
    const result = await checkForUpdatesNow({
      bridge: {
        checkForUpdates: async () => {
          throw new Error('ipc failed');
        },
      },
      now: new Date(CHECKED_AT),
    });

    expect(result).toEqual({
      status: 'error',
      version: null,
      detail: 'ipc failed',
      checkedAt: CHECKED_AT,
    });
  });
});

describe('describeUpdateOutcome', () => {
  it('renders the error detail the updater reported', () => {
    const text = describeUpdateOutcome(
      outcome({ status: 'error', version: null, detail: 'net::ERR_INTERNET_DISCONNECTED' }),
    );

    expect(text).toBe('Update check failed: net::ERR_INTERNET_DISCONNECTED');
  });

  it('names the version when an update is available', () => {
    expect(describeUpdateOutcome(outcome())).toBe('Version 0.1.4 is available.');
  });

  it('falls back to the bridge detail when an available outcome has no version', () => {
    expect(
      describeUpdateOutcome(
        outcome({ version: null, detail: 'Tuffcode 0.1.4 is available.' }),
      ),
    ).toBe('Tuffcode 0.1.4 is available.');
  });

  it('passes current and unavailable detail through', () => {
    expect(
      describeUpdateOutcome(
        outcome({ status: 'current', version: '0.1.3', detail: 'Tuffcode 0.1.3 is up to date.' }),
      ),
    ).toBe('Tuffcode 0.1.3 is up to date.');
    expect(
      describeUpdateOutcome(
        outcome({ status: 'unavailable', version: null, detail: 'Updates are disabled.' }),
      ),
    ).toBe('Updates are disabled.');
  });
});
