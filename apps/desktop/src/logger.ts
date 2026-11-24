import { createLogger, logsDir, type Logger } from '@tuffcode/shared';

/** Main-process logger writing to the shared logs directory with the `main` channel. */
export function createMainLogger(): Logger {
  return createLogger({ dir: logsDir(), channel: 'main' });
}
