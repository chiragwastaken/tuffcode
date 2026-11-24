import { randomBytes } from 'node:crypto';

/** `prefix_` plus 16 random hex characters. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}
