import type { ServerEvent } from '@tuffcode/contracts';

export interface TerminalData {
  terminalId: string;
  data: string;
}

/** The payload of a `terminal.data` event, or null for every other event type. */
export function terminalDataOf(event: ServerEvent): TerminalData | null {
  if (event.type !== 'terminal.data') return null;
  return event.payload;
}

/** The slice of the RPC client the router needs; lets tests pass a fake source. */
export interface TerminalEventSource {
  onEvent(callback: (event: ServerEvent) => void): () => void;
}

/**
 * Route pty output for one terminal to `write`. Data addressed to other
 * terminals (or to terminals this view no longer owns) is dropped.
 */
export function subscribeTerminalData(
  source: TerminalEventSource,
  terminalId: string,
  write: (data: string) => void,
): () => void {
  return source.onEvent((event) => {
    const chunk = terminalDataOf(event);
    if (!chunk || chunk.terminalId !== terminalId || chunk.data.length === 0) return;
    write(chunk.data);
  });
}
