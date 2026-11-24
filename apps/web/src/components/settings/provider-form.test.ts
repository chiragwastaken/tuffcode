import { methods, type ProviderKind, type ProviderView } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildProviderPayload,
  headersToText,
  parseHeadersText,
  providerDraftFromView,
  validateProviderDraft,
  type ProviderDraft,
} from './provider-form';

function draft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    kind: 'openai-compatible',
    label: 'Local model',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen3-coder',
    headers: '',
    secret: '',
    ...overrides,
  };
}

const providerView: ProviderView = {
  id: 'prov-1',
  kind: 'openai-compatible',
  label: 'Local model',
  config: {
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen3-coder',
    headers: { 'X-Org': 'team' },
    family: 'openai',
  },
  enabled: true,
  hasSecret: true,
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
};

describe('validateProviderDraft', () => {
  it('accepts a complete OpenAI-compatible provider', () => {
    expect(validateProviderDraft(draft())).toEqual({});
  });

  it('requires a label and a base URL for OpenAI-compatible providers', () => {
    expect(validateProviderDraft(draft({ label: '   ', baseUrl: '' }))).toEqual({
      label: 'Label is required.',
      baseUrl: 'Base URL is required for an OpenAI-compatible provider.',
    });
  });

  it('lets CLI providers omit the base URL', () => {
    expect(validateProviderDraft(draft({ kind: 'claude', baseUrl: '' }))).toEqual({});
  });

  it('rejects malformed and non-http base URLs', () => {
    expect(validateProviderDraft(draft({ baseUrl: 'not a url' }))).toEqual({
      baseUrl: 'Enter a valid URL.',
    });
    expect(validateProviderDraft(draft({ baseUrl: 'ftp://example.com' }))).toEqual({
      baseUrl: 'Base URL must use http or https.',
    });
  });

  it('rejects headers that are not a JSON object of strings', () => {
    expect(validateProviderDraft(draft({ headers: 'nope' }))).toEqual({
      headers: 'Headers must be valid JSON.',
    });
    expect(validateProviderDraft(draft({ headers: '[]' }))).toEqual({
      headers: 'Headers must be a JSON object.',
    });
    expect(validateProviderDraft(draft({ headers: '{"X-Org": 4}' }))).toEqual({
      headers: 'Header X-Org must be a string.',
    });
    expect(validateProviderDraft(draft({ headers: '{"Bad Header": "x"}' }))).toEqual({
      headers: 'Invalid header name: Bad Header',
    });
  });

  it('reports an unknown provider kind', () => {
    expect(validateProviderDraft(draft({ kind: 'bogus' as ProviderKind }))).toEqual({
      kind: 'Choose a provider kind.',
    });
  });
});

describe('parseHeadersText', () => {
  it('returns an empty object for blank input', () => {
    expect(parseHeadersText('  ')).toEqual({ headers: {} });
  });

  it('parses string values', () => {
    expect(parseHeadersText('{"X-Org":"team","Authorization":"Bearer x"}')).toEqual({
      headers: { 'X-Org': 'team', Authorization: 'Bearer x' },
    });
  });
});

describe('buildProviderPayload', () => {
  it('trims values and includes a provided secret', () => {
    const payload = buildProviderPayload(
      draft({
        label: '  Local  ',
        baseUrl: ' http://127.0.0.1:1234/v1 ',
        model: ' qwen ',
        secret: ' sk-local ',
      }),
    );

    expect(payload).toEqual({
      kind: 'openai-compatible',
      label: 'Local',
      config: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen' },
      secret: 'sk-local',
    });
    expect(methods['providers.upsert'].params.safeParse(payload).success).toBe(true);
  });

  it('omits the secret when the write-only field is blank', () => {
    const payload = buildProviderPayload(draft({ secret: '   ' }), {
      id: 'prov-1',
      existingConfig: { family: 'openai' },
    });

    expect(payload).not.toHaveProperty('secret');
    expect(payload.id).toBe('prov-1');
    expect(payload.config).toEqual({
      family: 'openai',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen3-coder',
    });
  });

  it('preserves unrelated config keys and removes cleared fields', () => {
    const payload = buildProviderPayload(
      draft({ baseUrl: '', model: '', headers: '', secret: '' }),
      {
        existingConfig: {
          baseUrl: 'http://old',
          model: 'old-model',
          headers: { 'X-Old': 'yes' },
          family: 'openai',
        },
      },
    );

    expect(payload.config).toEqual({ family: 'openai' });
  });

  it('writes parsed headers into the config', () => {
    const payload = buildProviderPayload(draft({ headers: '{"X-Org":"team"}' }));

    expect(payload.config.headers).toEqual({ 'X-Org': 'team' });
  });

  it('throws when headers are invalid instead of dropping them', () => {
    expect(() => buildProviderPayload(draft({ headers: '[]' }))).toThrow(
      'Headers must be a JSON object.',
    );
  });
});

describe('providerDraftFromView', () => {
  it('reads editable fields and never exposes the stored secret', () => {
    const result = providerDraftFromView(providerView);

    expect(result).toEqual({
      kind: 'openai-compatible',
      label: 'Local model',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen3-coder',
      headers: '{\n  "X-Org": "team"\n}',
      secret: '',
    });
  });

  it('returns an empty draft for a new provider', () => {
    expect(providerDraftFromView(null)).toEqual({
      kind: 'claude',
      label: '',
      baseUrl: '',
      model: '',
      headers: '',
      secret: '',
    });
  });

  it('serializes object headers and ignores non-object headers', () => {
    expect(headersToText({ 'X-Org': 'team' })).toBe('{\n  "X-Org": "team"\n}');
    expect(headersToText(['nope'])).toBe('');
    expect(headersToText(undefined)).toBe('');
  });
});
