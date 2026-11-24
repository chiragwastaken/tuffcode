export type Eol = 'crlf' | 'lf';

/** Line ending of the first newline in the text; defaults to LF when there is none. */
export function detectEol(text: string): Eol {
  const index = text.indexOf('\n');
  if (index === -1) return 'lf';
  return index > 0 && text[index - 1] === '\r' ? 'crlf' : 'lf';
}

/** Most frequent line ending in the text; ties and newline-free text resolve to LF. */
export function dominantEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue;
    if (index > 0 && text[index - 1] === '\r') crlf += 1;
    else lf += 1;
  }
  return crlf > lf ? 'crlf' : 'lf';
}

/**
 * Write-time conversion: rewrite CRLF and LF sequences to `eol`. A lone CR is left
 * alone, since it is not a line ending this app produces.
 */
export function applyEol(text: string, eol: Eol): string {
  const lf = text.replace(/\r?\n/g, '\n');
  return eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
}

/** Canonical conversion: every line ending, including a lone CR, becomes `eol`. */
export function normalizeEol(text: string, eol: Eol): string {
  const lf = text.replace(/\r\n?/g, '\n');
  return eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
}
