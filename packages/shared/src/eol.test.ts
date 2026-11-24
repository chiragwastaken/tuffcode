import { describe, expect, it } from 'vitest';
import { applyEol, detectEol, dominantEol, normalizeEol } from '@tuffcode/shared';

describe('detectEol', () => {
  it('reports the first line ending', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('crlf');
    expect(detectEol('a\nb\n')).toBe('lf');
    expect(detectEol('a\r\nb\n')).toBe('crlf');
    expect(detectEol('a\nb\r\n')).toBe('lf');
  });

  it('defaults to lf when there is no newline', () => {
    expect(detectEol('single line')).toBe('lf');
    expect(detectEol('')).toBe('lf');
  });
});

describe('dominantEol', () => {
  it('picks the majority ending', () => {
    expect(dominantEol('a\r\nb\r\nc\n')).toBe('crlf');
    expect(dominantEol('a\nb\nc\r\n')).toBe('lf');
    expect(dominantEol('no newline')).toBe('lf');
  });
});

describe('eol round-trip', () => {
  it('preserves CRLF through a lf normalization and back', () => {
    const crlf = 'first\r\nsecond\r\nthird\r\n';
    const lf = normalizeEol(crlf, 'lf');
    expect(lf).toBe('first\nsecond\nthird\n');
    expect(detectEol(lf)).toBe('lf');
    expect(applyEol(lf, 'crlf')).toBe(crlf);
    expect(normalizeEol(lf, 'crlf')).toBe(crlf);
  });

  it('preserves LF through a crlf round-trip', () => {
    const lf = 'a\nb\n';
    expect(normalizeEol(applyEol(lf, 'crlf'), 'lf')).toBe(lf);
  });

  it('is idempotent', () => {
    expect(applyEol(applyEol('a\nb', 'crlf'), 'crlf')).toBe('a\r\nb');
  });

  it('converts a lone CR only when normalizing', () => {
    expect(applyEol('a\rb', 'lf')).toBe('a\rb');
    expect(normalizeEol('a\rb', 'lf')).toBe('a\nb');
  });
});
