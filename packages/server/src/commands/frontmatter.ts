/** Options shared by command and skill discovery. */
export interface DiscoveryOptions {
  /** Receives a message for every skipped file. Defaults to stderr. */
  onWarning?: (message: string) => void;
}

/** Reports a skipped file; the RPC handlers route this to `server.warning`. */
export function warnSkipped(options: DiscoveryOptions, message: string): void {
  if (options.onWarning !== undefined) options.onWarning(message);
  else process.stderr.write(`tuffcode: ${message}\n`);
}

export interface Frontmatter {
  /** Flat string values from the header. Keys are lowercased. */
  readonly data: Readonly<Record<string, string>>;
  /** Text after the closing delimiter, with surrounding whitespace trimmed. */
  readonly body: string;
}

const OPENING = /^---[ \t]*\r?\n/;
const CLOSING = /^---[ \t]*$/m;

/**
 * Parses the simple `key: value` frontmatter used by command and skill markdown.
 * Returns null when the file has no header or the header is never closed, so
 * discovery can skip the file instead of guessing. Nested YAML is not supported.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const source = text.replace(/^\uFEFF/, '');
  const opening = OPENING.exec(source);
  if (opening === null) return null;
  const rest = source.slice(opening[0].length);
  const closing = CLOSING.exec(rest);
  if (closing === null) return null;
  const header = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length).replace(/^\r?\n/, '');
  const data: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    let value = trimmed.slice(colon + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    if (key.length > 0) data[key] = value;
  }
  return { data, body: body.trim() };
}
