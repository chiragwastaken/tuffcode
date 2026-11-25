import type { TuffcodeBridge, UpdateCheckOutcome } from '../../types';

const NO_FEED_DETAIL = 'Updates run in packaged builds. This build has no update feed.';

function errorOutcome(error: unknown, now: Date): UpdateCheckOutcome {
  return {
    status: 'error',
    version: null,
    detail: error instanceof Error ? error.message : String(error),
    checkedAt: now.toISOString(),
  };
}

/**
 * Runs one update check through the preload bridge. A dev build has no preload
 * updater, so the check reports that instead of inventing an endpoint; a bridge
 * rejection is reported as an error outcome so the button never hangs.
 */
export async function checkForUpdatesNow(input: {
  bridge?: Pick<TuffcodeBridge, 'checkForUpdates'>;
  now?: Date;
}): Promise<UpdateCheckOutcome> {
  const now = input.now ?? new Date();
  const check = input.bridge?.checkForUpdates;
  if (typeof check === 'function') {
    try {
      return await check();
    } catch (error) {
      return errorOutcome(error, now);
    }
  }
  return {
    status: 'unavailable',
    version: null,
    detail: NO_FEED_DETAIL,
    checkedAt: now.toISOString(),
  };
}

/** The sentence the settings result line shows for one outcome. */
export function describeUpdateOutcome(outcome: UpdateCheckOutcome): string {
  switch (outcome.status) {
    case 'available':
      return outcome.version === null
        ? outcome.detail
        : `Version ${outcome.version} is available.`;
    case 'error':
      return `Update check failed: ${outcome.detail}`;
    case 'current':
    case 'unavailable':
      return outcome.detail;
  }
}
