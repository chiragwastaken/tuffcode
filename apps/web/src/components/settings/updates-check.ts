import type { UpdateChannel } from '@tuffcode/contracts';

export interface UpdateCheckResult {
  status: 'unavailable';
  version: string;
  channel: UpdateChannel;
  checkedAt: string;
  detail: string;
}

/**
 * This build ships no update feed. electron-updater only runs in packaged builds
 * with the updater enabled, so a check from the settings window reports what the
 * packaged build would do instead of pretending to contact a server.
 */
export function packagedUpdateCheck(input: {
  version: string;
  channel: UpdateChannel;
  now?: Date;
}): UpdateCheckResult {
  const now = input.now ?? new Date();
  return {
    status: 'unavailable',
    version: input.version,
    channel: input.channel,
    checkedAt: now.toISOString(),
    detail: `No update feed is configured for this build. Packaged builds check the ${input.channel} channel at launch.`,
  };
}
