import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelCapabilities } from '@tuffcode/contracts';
import { z } from 'zod';
import type { DiscoveredModel } from '../adapters/factory.js';

/**
 * Model metadata enrichment. Discovery often returns ids only; this fills the gaps
 * (context window, output limit, tools, vision, reasoning) from, in order: Ollama's
 * `/api/show`, LM Studio's `/api/v0/models`, then a compact index built from the
 * open models.dev registry. A value discovery already reported is never replaced.
 * models.dev is fetched only on a user-pressed refresh and at most weekly.
 */
export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const MODELS_DEV_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MODELS_DEV_BYTE_LIMIT = 24 * 1024 * 1024;
export const LOCAL_SHOW_LIMIT = 60;

export type MetaFetch = (input: string, init: RequestInit) => Promise<Response>;

/** One compact index row: context, output, tools, reasoning, vision. */
export interface MetaRow {
  c: number | null;
  o: number | null;
  t: boolean;
  r: boolean;
  v: boolean;
}

export type MetaIndex = Record<string, MetaRow>;

const DevModelSchema = z
  .object({
    id: z.string(),
    tool_call: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    attachment: z.boolean().optional(),
    modalities: z.object({ input: z.array(z.string()).optional() }).passthrough().optional(),
    limit: z.object({ context: z.number().optional(), output: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

const DevProviderSchema = z.object({ models: z.record(z.string(), z.unknown()) }).passthrough();

function positive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Builds the id index from the raw models.dev payload; `provider/id` and bare `id` both map. */
export function buildMetaIndex(raw: unknown): MetaIndex {
  const index: MetaIndex = {};
  if (typeof raw !== 'object' || raw === null) return index;
  for (const [providerId, providerRaw] of Object.entries(raw)) {
    const provider = DevProviderSchema.safeParse(providerRaw);
    if (!provider.success) continue;
    for (const modelRaw of Object.values(provider.data.models)) {
      const model = DevModelSchema.safeParse(modelRaw);
      if (!model.success) continue;
      const row: MetaRow = {
        c: positive(model.data.limit?.context),
        o: positive(model.data.limit?.output),
        t: model.data.tool_call === true,
        r: model.data.reasoning === true,
        v: model.data.attachment === true || (model.data.modalities?.input ?? []).includes('image'),
      };
      if (row.c === null && row.o === null) continue;
      const id = model.data.id.toLowerCase();
      index[`${providerId.toLowerCase()}/${id}`] = row;
      // The bare id keeps the largest window seen, which is the vendor's own listing.
      const existing = index[id];
      if (existing === undefined || (row.c ?? 0) > (existing.c ?? 0)) index[id] = row;
    }
  }
  return index;
}

/** Exact id, then without a routing prefix (`openai/gpt-5` to `gpt-5`), then without a tag. */
export function lookupMeta(index: MetaIndex, modelId: string): MetaRow | null {
  const id = modelId.trim().toLowerCase();
  const candidates = [id, id.split('/').slice(1).join('/'), id.split('/').at(-1) ?? id, id.replace(/:[^/]+$/, '')];
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    const row = index[candidate];
    if (row !== undefined) return row;
  }
  return null;
}

function merge(model: DiscoveredModel, fill: Partial<MetaRow> & { efforts?: string[] }): DiscoveredModel {
  const capabilities: ModelCapabilities | null =
    model.capabilities ??
    (fill.t === undefined && fill.r === undefined && fill.v === undefined
      ? null
      : {
          tools: fill.t === true,
          vision: fill.v === true,
          reasoning: fill.r === true,
          reasoningEfforts: fill.r === true ? (fill.efforts ?? []) : [],
        });
  return {
    ...model,
    contextWindow: model.contextWindow ?? fill.c ?? null,
    maxOutputTokens: model.maxOutputTokens ?? fill.o ?? null,
    capabilities,
  };
}

function incomplete(model: DiscoveredModel): boolean {
  return model.contextWindow === null || model.maxOutputTokens === null || model.capabilities === null;
}

/** The server root of an OpenAI-compatible base URL, without a trailing `/v1`. */
export function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

export type LocalFlavor = 'ollama' | 'lmstudio' | null;

export function localFlavor(baseUrl: string | null, configured: unknown): LocalFlavor {
  if (configured === 'ollama' || configured === 'lmstudio') return configured;
  if (baseUrl === null) return null;
  try {
    const port = new URL(baseUrl).port;
    if (port === '11434') return 'ollama';
    if (port === '1234') return 'lmstudio';
  } catch {
    return null;
  }
  return null;
}

async function json(fetchFn: MetaFetch, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

const OllamaShowSchema = z
  .object({
    capabilities: z.array(z.string()).optional(),
    model_info: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Ollama reports the window under `<family>.context_length` and its abilities as a list. */
export function parseOllamaShow(raw: unknown): Partial<MetaRow> {
  const parsed = OllamaShowSchema.safeParse(raw);
  if (!parsed.success) return {};
  let context: number | null = null;
  for (const [key, value] of Object.entries(parsed.data.model_info ?? {})) {
    if (key.endsWith('.context_length') && typeof value === 'number') context = positive(value);
  }
  const caps = parsed.data.capabilities;
  return {
    c: context,
    ...(caps === undefined ? {} : { t: caps.includes('tools'), v: caps.includes('vision'), r: caps.includes('thinking') }),
  };
}

const LmStudioSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        type: z.string().optional(),
        max_context_length: z.number().optional(),
        capabilities: z.array(z.string()).optional(),
      })
      .passthrough(),
  ),
});

export function parseLmStudio(raw: unknown): Map<string, Partial<MetaRow>> {
  const out = new Map<string, Partial<MetaRow>>();
  const parsed = LmStudioSchema.safeParse(raw);
  if (!parsed.success) return out;
  for (const model of parsed.data.data) {
    out.set(model.id, {
      c: positive(model.max_context_length),
      t: (model.capabilities ?? []).includes('tool_use'),
      v: model.type === 'vlm',
    });
  }
  return out;
}

export interface EnrichOptions {
  baseUrl: string | null;
  flavor?: unknown;
  headers?: Record<string, string>;
  fetchFn?: MetaFetch;
  cacheDir?: string;
  /** True only on a user-pressed refresh: allows the weekly models.dev download. */
  allowRegistryFetch: boolean;
  now?: () => number;
  timeoutMs?: number;
}

const IndexFileSchema = z.object({ fetchedAt: z.number(), index: z.record(z.string(), z.unknown()) });

async function loadIndex(options: EnrichOptions, fetchFn: MetaFetch): Promise<MetaIndex | null> {
  if (options.cacheDir === undefined) return null;
  const file = join(options.cacheDir, 'models-dev.json');
  const now = options.now ?? Date.now;
  let cached: { fetchedAt: number; index: MetaIndex } | null = null;
  try {
    const parsed = IndexFileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    if (parsed.success) cached = { fetchedAt: parsed.data.fetchedAt, index: parsed.data.index as MetaIndex };
  } catch {
    cached = null;
  }
  const stale = cached === null || now() - cached.fetchedAt > MODELS_DEV_TTL_MS;
  if (!stale || !options.allowRegistryFetch) return cached?.index ?? null;
  try {
    const response = await fetchFn(MODELS_DEV_URL, {
      headers: { accept: 'application/json', 'user-agent': 'Tuffcode' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return cached?.index ?? null;
    const text = await response.text();
    if (text.length > MODELS_DEV_BYTE_LIMIT) return cached?.index ?? null;
    const index = buildMetaIndex(JSON.parse(text));
    await mkdir(options.cacheDir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify({ fetchedAt: now(), index }));
    await rename(`${file}.tmp`, file);
    return index;
  } catch {
    return cached?.index ?? null;
  }
}

export async function enrichModels(
  models: readonly DiscoveredModel[],
  options: EnrichOptions,
): Promise<DiscoveredModel[]> {
  if (!models.some(incomplete)) return [...models];
  const fetchFn: MetaFetch = options.fetchFn ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 5000;
  let result = [...models];
  const flavor = localFlavor(options.baseUrl, options.flavor);
  const root = options.baseUrl === null ? null : serverRoot(options.baseUrl);

  if (flavor === 'ollama' && root !== null) {
    const targets = result.filter(incomplete).slice(0, LOCAL_SHOW_LIMIT);
    const fills = new Map<string, Partial<MetaRow>>();
    for (let start = 0; start < targets.length; start += 4) {
      await Promise.all(
        targets.slice(start, start + 4).map(async (model) => {
          try {
            fills.set(
              model.id,
              parseOllamaShow(
                await json(
                  fetchFn,
                  `${root}/api/show`,
                  { method: 'POST', headers: { 'content-type': 'application/json', ...options.headers }, body: JSON.stringify({ model: model.id }) },
                  timeoutMs,
                ),
              ),
            );
          } catch {
            // A model Ollama cannot describe keeps what discovery reported.
          }
        }),
      );
    }
    result = result.map((model) => (fills.has(model.id) ? merge(model, fills.get(model.id) ?? {}) : model));
  } else if (flavor === 'lmstudio' && root !== null) {
    try {
      const fills = parseLmStudio(await json(fetchFn, `${root}/api/v0/models`, { headers: options.headers ?? {} }, timeoutMs));
      result = result.map((model) => (fills.has(model.id) ? merge(model, fills.get(model.id) ?? {}) : model));
    } catch {
      // Older LM Studio builds have no v0 API; the registry may still fill the gaps.
    }
  }

  if (!result.some(incomplete)) return result;
  const index = await loadIndex(options, fetchFn);
  if (index === null) return result;
  return result.map((model) => {
    if (!incomplete(model)) return model;
    const row = lookupMeta(index, model.id);
    return row === null ? model : merge(model, row);
  });
}
