export { commandExists, FALLBACK_SHELLS, resolveShell, type ShellExists } from './shell.js';
export {
  TerminalService,
  terminalEnv,
  type TerminalDataEvent,
  type TerminalDataSink,
  type TerminalServiceOptions,
  type TerminalSessionInfo,
} from './service.js';
export { createTerminalHandlers, TERMINAL_METHODS, type TerminalMethod } from './handlers.js';
