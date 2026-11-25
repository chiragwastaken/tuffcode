import { describe, expect, it } from 'vitest';
import type { DiscoveredModel } from '../adapters/factory.js';
import { createTempEnv } from '../test-support.js';
import {
  buildMetaIndex,
  enrichModels,
  localFlavor,
  lookupMeta,
  parseLmStudio,
  parseOllamaShow,
  serverRoot,
  type MetaFetch,
} from './models-dev.js';

function bare(id: string, overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return { id, label: id, contextWindow: null, maxOutputTokens: null, capabilities: null, reasoningEffort: null, ...overrides };
}

const DEV_PAYLOAD = {
  openai: {
    models: {
      'gpt-5': { id: 'gpt-5', tool_call: true, reasoning: true, attachment: true, limit: { context: 400000, output: 128000 } },
      'tiny-image': { id: 'tiny-image', limit: { context: 0, output: 0 } },
    },
  },
  openrouter: {
    models: { 'openai/gpt-5': { id: 'openai/gpt-5', tool_call: true, limit: { context: 200000, output: 64000 } } },
  },
};

describe('model metadata enrichment', () => {
  it('indexes models.dev rows and resolves prefixed and tagged ids', () => {
    const index = buildMetaIndex(DEV_PAYLOAD);
    expect(index['gpt-5']).toEqual({ c: 400000, o: 128000, t: true, r: true, v: true });
    expect(index['tiny-image']).toBeUndefined();
    expect(lookupMeta(index, 'openai/gpt-5')?.c).toBe(400000);
    expect(lookupMeta(index, 'openrouter/openai/gpt-5')?.c).toBe(200000);
    expect(lookupMeta(index, 'azure/gpt-5')?.c).toBe(400000);
    expect(lookupMeta(index, 'GPT-5')?.o).toBe(128000);
    expect(lookupMeta(index, 'unknown-model')).toBeNull();
    expect(buildMetaIndex('nope')).toEqual({});
  });

  it('reads Ollama and LM Studio metadata', () => {
    expect(
      parseOllamaShow({ model_info: { 'llama.context_length': 131072 }, capabilities: ['completion', 'tools', 'thinking'] }),
    ).toEqual({ c: 131072, t: true, v: false, r: true });
    expect(parseOllamaShow({ nope: 1 })).toEqual({ c: null });
    expect(
      parseLmStudio({ data: [{ id: 'qwen-vl', type: 'vlm', max_context_length: 32768, capabilities: ['tool_use'] }] }).get('qwen-vl'),
    ).toEqual({ c: 32768, t: true, v: true });
    expect(localFlavor('http://localhost:11434/v1', undefined)).toBe('ollama');
    expect(localFlavor('http://127.0.0.1:1234/v1', undefined)).toBe('lmstudio');
    expect(localFlavor('https://api.example.com/v1', 'ollama')).toBe('ollama');
    expect(localFlavor('https://api.example.com/v1', undefined)).toBeNull();
    expect(serverRoot('http://localhost:11434/v1/')).toBe('http://localhost:11434');
  });

  it('fills only missing fields from Ollama, then from the registry on refresh', async () => {
    const env = createTempEnv();
    try {
      const calls: string[] = [];
      const fetchFn: MetaFetch = async (url) => {
        calls.push(url);
        if (url.endsWith('/api/show')) {
          return new Response(JSON.stringify({ model_info: { 'qwen.context_length': 32768 }, capabilities: ['tools'] }));
        }
        return new Response(JSON.stringify(DEV_PAYLOAD));
      };
      const models = [bare('qwen3'), bare('gpt-5', { contextWindow: 1000 })];
      const local = await enrichModels(models, {
        baseUrl: 'http://localhost:11434/v1',
        fetchFn,
        cacheDir: env.root,
        allowRegistryFetch: false,
      });
      expect(local[0]).toMatchObject({ contextWindow: 32768, capabilities: { tools: true, vision: false } });
      expect(local[1]?.contextWindow).toBe(1000);
      expect(calls.some((url) => url.includes('models.dev'))).toBe(false);

      const remote = await enrichModels([bare('gpt-5', { contextWindow: 1000 })], {
        baseUrl: 'https://api.openai.com/v1',
        fetchFn,
        cacheDir: env.root,
        allowRegistryFetch: true,
      });
      expect(remote[0]).toMatchObject({
        contextWindow: 1000,
        maxOutputTokens: 128000,
        capabilities: { tools: true, vision: true, reasoning: true },
      });
      // The index is cached; a later non-refresh call reads it without the network.
      calls.length = 0;
      const cached = await enrichModels([bare('gpt-5')], {
        baseUrl: 'https://api.openai.com/v1',
        fetchFn,
        cacheDir: env.root,
        allowRegistryFetch: false,
      });
      expect(cached[0]?.contextWindow).toBe(400000);
      expect(calls).toEqual([]);
    } finally {
      env.dispose();
    }
  });
});
