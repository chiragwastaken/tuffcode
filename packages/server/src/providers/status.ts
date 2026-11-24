import type { CommandResult } from './command.js';

export interface AuthStatus {
  signedIn: boolean;
  detail: string;
}

function nonEmptyLines(result: CommandResult): string[] {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * `claude auth status --json` prints one JSON object with `loggedIn` and `authMethod`.
 * Anything else is reported as an unknown state rather than guessed from the exit code.
 */
export function parseClaudeAuthStatus(result: CommandResult): AuthStatus {
  const raw = result.stdout.trim();
  if (raw.length === 0) {
    return { signedIn: false, detail: `claude auth status exited with code ${result.code}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { signedIn: false, detail: 'claude auth status did not report JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { signedIn: false, detail: 'claude auth status did not report JSON' };
  }
  const record = parsed as Record<string, unknown>;
  if (record['loggedIn'] !== true) return { signedIn: false, detail: 'not signed in' };
  const method = record['authMethod'];
  return {
    signedIn: true,
    detail: typeof method === 'string' && method.length > 0 ? `signed in (${method})` : 'signed in',
  };
}

/**
 * `codex login status` writes its verdict to stderr and exits 0 only when signed in.
 * The API-key variant prints a masked key, which is deliberately not echoed back.
 */
export function parseCodexLoginStatus(result: CommandResult): AuthStatus {
  const lines = nonEmptyLines(result);
  const signedIn =
    result.code === 0 && lines.some((line) => /^(logged in using|api key configured)/i.test(line));
  if (!signedIn) {
    const reason = lines.at(-1);
    return {
      signedIn: false,
      detail: reason ?? `codex login status exited with code ${result.code}`,
    };
  }
  if (lines.some((line) => /^api key configured/i.test(line))) {
    return { signedIn: true, detail: 'signed in with an API key' };
  }
  const loggedIn = lines.find((line) => /^logged in using/i.test(line));
  return { signedIn: true, detail: loggedIn ?? 'signed in' };
}
