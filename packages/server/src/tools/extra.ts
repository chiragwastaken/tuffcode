import {
  BrainKindSchema,
  ModelCapabilitiesSchema,
  ProviderKindSchema,
  ReasoningEffortSchema,
  SettingsPatchSchema,
  type BrainEntry,
  type ModelCapabilities,
  type Settings,
} from '@tuffcode/contracts';
import { z } from 'zod';
import type { MemorySearchInput, MemorySearchResult } from '../brain/search.js';
import type { Repos, UpsertBrainInput } from '../db/repos/index.js';
import type { McpService } from '../mcp/service.js';
import type { ProvidersService } from '../providers/service.js';

/**
 * The server-side extra tools, D47 to D49. The adapter harness calls `run` for the
 * `mcp`, `memory` and `config` tools; every failure comes back as a short string so a
 * bad tool call never kills the turn.
 */
export type ExtraToolRunner = (
  name: string,
  args: Record<string, unknown>,
  ctx: { cwd: string },
) => Promise<string>;

/** Settings the agent may change through the `config` tool, D48. */
export const SETTINGS_ALLOWLIST = [
  'theme',
  'defaultPermissionMode',
  'maxOutputTokens',
  'autoCompact',
  'brainEnabled',
  'subagentModels',
  'subagentConcurrency',
  'enabledTools',
] as const;

type AllowedSettingKey = (typeof SETTINGS_ALLOWLIST)[number];

export interface ExtraToolBrain {
  search(input: MemorySearchInput): MemorySearchResult;
  add(input: UpsertBrainInput): BrainEntry;
}

export interface ExtraToolDeps {
  repos: Repos;
  settings(): Settings;
  providers: ProvidersService;
  mcp: McpService;
  brain: ExtraToolBrain;
}

const ArgumentsSchema = z.record(z.string(), z.unknown());
const StringArraySchema = z.array(z.string());
const StringRecordSchema = z.record(z.string(), z.string());
const ConfigModelSchema = z.record(z.string(), z.unknown());

/** MCP env values are stored in plain text, so secret-shaped names are refused, D48. */
const SECRET_ENV_KEY = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed';
}

function isAllowedSetting(key: string): key is AllowedSettingKey {
  return (SETTINGS_ALLOWLIST as readonly string[]).includes(key);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveInteger(value: unknown, key: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function jsonValue(value: unknown, key: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${key} must be valid JSON`);
  }
}

function parseCapabilities(value: unknown): ModelCapabilities | undefined {
  if (value === undefined) return undefined;
  const parsed = ModelCapabilitiesSchema.partial().safeParse(jsonValue(value, 'capabilities'));
  if (!parsed.success) {
    throw new Error('capabilities must be an object with tools, vision, reasoning, reasoningEfforts');
  }
  return {
    tools: parsed.data.tools ?? false,
    vision: parsed.data.vision ?? false,
    reasoning: parsed.data.reasoning ?? false,
    reasoningEfforts: parsed.data.reasoningEfforts ?? [],
  };
}

function parseReasoning(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = ReasoningEffortSchema.safeParse(value);
  if (!parsed.success) throw new Error(`unknown reasoning effort: ${value}`);
  return parsed.data;
}

function normalizePath(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function clampImportance(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function parseSettingValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function oneLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

export function createExtraTools(deps: ExtraToolDeps): { run: ExtraToolRunner } {
  /** The thread worktree wins over the project root so memory follows the checkout. */
  function resolveScope(cwd: string): { projectId?: string; threadId?: string } {
    const target = normalizePath(cwd);
    const thread = deps.repos.threads
      .list()
      .find((entry) => entry.worktreePath !== null && normalizePath(entry.worktreePath) === target);
    if (thread !== undefined) return { projectId: thread.projectId, threadId: thread.id };
    const project = deps.repos.projects.findByPath(cwd);
    return project === undefined ? {} : { projectId: project.id };
  }

  function requireBrain(): void {
    if (!deps.settings().brainEnabled) throw new Error('brain is disabled in settings');
  }

  async function mcpList(): Promise<string> {
    const servers = deps.repos.mcp.list();
    if (servers.length === 0) return 'No MCP servers configured.';
    const lines: string[] = [];
    for (const server of servers) {
      if (!server.enabled) {
        lines.push(`${server.label} (${server.id}): disabled`);
        continue;
      }
      try {
        const tools = await deps.mcp.listTools(server.id);
        if (tools.length === 0) {
          lines.push(`${server.label} (${server.id}): no tools`);
          continue;
        }
        lines.push(`${server.label} (${server.id}):`);
        for (const tool of tools) {
          const description = oneLine(tool.description);
          lines.push(
            description.length === 0 ? `  ${tool.name}` : `  ${tool.name}: ${description}`,
          );
        }
      } catch (error) {
        lines.push(`${server.label} (${server.id}): unavailable - ${failure(error)}`);
      }
    }
    return lines.join('\n');
  }

  async function mcpCall(args: Record<string, unknown>): Promise<string> {
    const server = requireString(args, 'server');
    const tool = requireString(args, 'tool');
    let toolArgs: Record<string, unknown> = {};
    const raw = args['arguments'];
    if (raw !== undefined && !(typeof raw === 'string' && raw.trim().length === 0)) {
      const parsed = ArgumentsSchema.safeParse(jsonValue(raw, 'arguments'));
      if (!parsed.success) throw new Error('arguments must be a JSON object');
      toolArgs = parsed.data;
    }
    return deps.mcp.callTool(server, tool, toolArgs);
  }

  function memorySearch(args: Record<string, unknown>, cwd: string): string {
    requireBrain();
    const query = requireString(args, 'query');
    const scope = resolveScope(cwd);
    const result = deps.brain.search({
      ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
      query,
      limit: 8,
    });
    const entries = result.entries.slice(0, 8);
    if (entries.length === 0) return 'No matching memory entries.';
    return entries
      .map((entry) => `${entry.kind} ${entry.text} (${entry.score.toFixed(2)}, ${entry.reason})`)
      .join('\n');
  }

  function memoryAdd(args: Record<string, unknown>, cwd: string): string {
    requireBrain();
    const text = requireString(args, 'text');
    const kindText = optionalString(args, 'kind') ?? 'memory';
    const kind = BrainKindSchema.safeParse(kindText);
    if (!kind.success) throw new Error(`unknown memory kind: ${kindText}`);
    const tags = (optionalString(args, 'tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .join(',');
    const scope = resolveScope(cwd);
    const entry = deps.brain.add({
      kind: kind.data,
      scope: scope.projectId ?? 'global',
      projectId: scope.projectId ?? null,
      text,
      tags,
      importance: clampImportance(args['importance']),
    });
    return entry.id;
  }

  async function providerAdd(args: Record<string, unknown>): Promise<string> {
    const kindText = requireString(args, 'kind');
    const kind = ProviderKindSchema.safeParse(kindText);
    if (!kind.success) throw new Error(`unknown provider kind: ${kindText}`);
    const label = requireString(args, 'label');
    const config: Record<string, unknown> = {};
    const baseUrl = optionalString(args, 'baseUrl');
    if (baseUrl !== undefined) config['baseUrl'] = baseUrl;
    const model = optionalString(args, 'model');
    if (model !== undefined) config['model'] = model;
    if (args['contextWindow'] !== undefined) {
      config['contextWindow'] = positiveInteger(args['contextWindow'], 'contextWindow');
    }
    if (args['maxOutputTokens'] !== undefined) {
      config['maxOutputTokens'] = positiveInteger(args['maxOutputTokens'], 'maxOutputTokens');
    }
    const capabilities = parseCapabilities(args['capabilities']);
    if (capabilities !== undefined) config['capabilities'] = capabilities;
    const reasoning = parseReasoning(optionalString(args, 'reasoning'));
    if (reasoning !== undefined) config['reasoningEffort'] = reasoning;
    // The key never travels through a tool; it is set in Settings > Providers.
    const view = await deps.providers.upsert({ kind: kind.data, label, config });
    return view.id;
  }

  async function providerModelAdd(args: Record<string, unknown>): Promise<string> {
    const providerId = requireString(args, 'providerId');
    const modelId = requireString(args, 'modelId');
    const record = deps.repos.providers.get(providerId);
    if (record === undefined) throw new Error(`provider not found: ${providerId}`);
    const config: Record<string, unknown> = { ...record.config };
    const stored = z.array(z.unknown()).safeParse(config['models']);
    const models: unknown[] = stored.success ? [...stored.data] : [];
    const index = models.findIndex((entry) => {
      const parsed = ConfigModelSchema.safeParse(entry);
      return parsed.success && parsed.data['id'] === modelId;
    });
    if (index >= 0) {
      const previous = ConfigModelSchema.safeParse(models[index]);
      const entry: Record<string, unknown> = previous.success ? { ...previous.data } : {};
      entry['id'] = modelId;
      if (typeof entry['label'] !== 'string' || entry['label'].length === 0) {
        entry['label'] = modelId;
      }
      models[index] = entry;
    } else {
      models.push({ id: modelId, label: modelId, isDefault: models.length === 0 });
    }
    config['models'] = models;
    await deps.providers.upsert({
      id: providerId,
      kind: record.kind,
      label: record.label,
      config,
    });
    return `${providerId}:${modelId}`;
  }

  function mcpAdd(args: Record<string, unknown>): string {
    const label = requireString(args, 'label');
    const command = requireString(args, 'command');
    let commandArgs: string[] | undefined;
    if (args['args'] !== undefined) {
      const parsed = StringArraySchema.safeParse(jsonValue(args['args'], 'args'));
      if (!parsed.success) throw new Error('args must be an array of strings');
      commandArgs = parsed.data;
    }
    let env: Record<string, string> | undefined;
    if (args['env'] !== undefined) {
      const parsed = StringRecordSchema.safeParse(jsonValue(args['env'], 'env'));
      if (!parsed.success) throw new Error('env must be an object of strings');
      for (const key of Object.keys(parsed.data)) {
        if (SECRET_ENV_KEY.test(key)) {
          throw new Error(
            `env ${key} looks like a secret; set MCP secrets in Settings > MCP env`,
          );
        }
      }
      env = parsed.data;
    }
    const cwd = optionalString(args, 'cwd');
    const server = deps.mcp.upsert({
      label,
      command,
      ...(commandArgs === undefined ? {} : { args: commandArgs }),
      ...(env === undefined ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
    });
    return server.id;
  }

  function settingsSet(args: Record<string, unknown>): string {
    const key = requireString(args, 'key');
    if (!isAllowedSetting(key)) {
      throw new Error(`setting not allowed: ${key} (allowed: ${SETTINGS_ALLOWLIST.join(', ')})`);
    }
    if (args['value'] === undefined) throw new Error('value is required');
    const patch = SettingsPatchSchema.parse({ [key]: parseSettingValue(args['value']) });
    if (patch[key] === undefined) throw new Error(`invalid value for ${key}`);
    deps.repos.settings.patch(patch);
    return key;
  }

  async function configAction(args: Record<string, unknown>): Promise<string> {
    const action = requireString(args, 'action');
    switch (action) {
      case 'provider.add':
        return providerAdd(args);
      case 'provider.model.add':
        return providerModelAdd(args);
      case 'mcp.add':
        return mcpAdd(args);
      case 'settings.set':
        return settingsSet(args);
      default:
        throw new Error(`unknown config action: ${action}`);
    }
  }

  return {
    run: async (name, args, ctx) => {
      try {
        switch (name) {
          case 'mcp': {
            const action = requireString(args, 'action');
            if (action === 'list') return await mcpList();
            if (action === 'call') return await mcpCall(args);
            throw new Error(`unknown mcp action: ${action}`);
          }
          case 'memory': {
            const action = requireString(args, 'action');
            if (action === 'search') return memorySearch(args, ctx.cwd);
            if (action === 'add') return memoryAdd(args, ctx.cwd);
            throw new Error(`unknown memory action: ${action}`);
          }
          case 'config':
            return await configAction(args);
          default:
            throw new Error(`unknown tool: ${name}`);
        }
      } catch (error) {
        return failure(error);
      }
    },
  };
}
