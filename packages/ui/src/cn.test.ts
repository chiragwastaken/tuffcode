import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps the last of two conflicting utilities', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-xs')).toBe('text-xs');
  });

  it('dedupes conflicts inside the same variant', () => {
    expect(cn('hover:bg-accent', 'hover:bg-primary')).toBe('hover:bg-primary');
  });

  it('keeps utilities that do not conflict', () => {
    expect(cn('flex', 'items-center', 'gap-2')).toBe('flex items-center gap-2');
  });

  it('drops falsy values', () => {
    expect(cn('text-sm', false, undefined, null, '')).toBe('text-sm');
  });

  it('flattens arrays and conditional objects', () => {
    expect(cn(['h-8'], { 'h-9': true, hidden: false })).toBe('h-9');
  });

  it('returns an empty string when nothing is passed', () => {
    expect(cn()).toBe('');
  });
});
