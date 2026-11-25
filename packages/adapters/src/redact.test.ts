import { describe, expect, it } from 'vitest';
import { redactToolInput } from './redact.js';

describe('redactToolInput', () => {
  it('masks every secret-shaped key', () => {
    const redacted = redactToolInput({
      apiKey: 'sk-live',
      api_key: 'sk-snake',
      secret: 'shh',
      token: 'tok',
      password: 'hunter2',
      credential: 'cred',
      authorization: 'Bearer abc',
      label: 'Local',
      count: 3,
    });

    expect(redacted).toEqual({
      apiKey: '[redacted]',
      api_key: '[redacted]',
      secret: '[redacted]',
      token: '[redacted]',
      password: '[redacted]',
      credential: '[redacted]',
      authorization: '[redacted]',
      label: 'Local',
      count: 3,
    });
  });

  it('masks secret keys in nested objects and arrays', () => {
    const redacted = redactToolInput({
      action: 'mcp.call',
      arguments: {
        servers: [
          { url: 'https://one.example', headers: { authorization: 'Bearer one' } },
          { url: 'https://two.example', headers: { authorization: 'Bearer two' } },
        ],
      },
    });

    expect(redacted).toEqual({
      action: 'mcp.call',
      arguments: {
        servers: [
          { url: 'https://one.example', headers: { authorization: '[redacted]' } },
          { url: 'https://two.example', headers: { authorization: '[redacted]' } },
        ],
      },
    });
  });

  it('keeps non-secret values, including nested primitives', () => {
    const input = {
      path: 'src/app.tsx',
      options: { deep: [1, 'two', true, null, { keep: 'me' }] },
    };

    expect(redactToolInput(input)).toEqual(input);
  });

  it('returns a copy so the executed arguments are never mutated', () => {
    const input = { apiKey: 'sk-live', nested: { token: 'tok' } };
    const redacted = redactToolInput(input);

    expect(redacted).not.toBe(input);
    expect(redacted).not.toBe(input.nested);
    expect(input.apiKey).toBe('sk-live');
    expect(input.nested.token).toBe('tok');
  });

  it('collapses containers past the depth cap instead of leaking a deep secret', () => {
    const input = {
      a: { b: { c: { d: { e: { f: { apiKey: 'sk-deep' } } } } } },
    };

    expect(JSON.stringify(redactToolInput(input))).not.toContain('sk-deep');
  });

  it('stops walking after 500 keys', () => {
    const input: Record<string, string> = {};
    for (let index = 0; index < 600; index += 1) input['k' + String(index)] = 'v' + String(index);

    const redacted = redactToolInput(input) as Record<string, string>;

    expect(Object.keys(redacted)).toHaveLength(500);
  });

  it('passes primitives and non-plain objects through untouched', () => {
    const date = new Date('2026-11-25T00:00:00.000Z');

    expect(redactToolInput('raw text')).toBe('raw text');
    expect(redactToolInput(42)).toBe(42);
    expect(redactToolInput(null)).toBeNull();
    expect(redactToolInput(undefined)).toBeUndefined();
    expect(redactToolInput(date)).toBe(date);
  });
});
