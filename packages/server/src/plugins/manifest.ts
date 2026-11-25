import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { PluginComponents } from '@tuffcode/contracts';
import { isInside } from '@tuffcode/shared';
import { z } from 'zod';
import { parseFrontmatter } from '../commands/frontmatter.js';

/**
 * Reads an installed plugin directory in the Claude Code layout. Skills, commands and
 * MCP servers are used; agents and hooks are listed so the UI can say they exist, but
 * Tuffcode never executes plugin hooks. Every path the manifest names must resolve
 * inside the plugin directory.
 */
export type PluginMcpServer =
  | { name: string; transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { name: string; transport: 'http'; url: string; headers: Record<string, string> };

export interface PluginManifest {
  name: string | null;
  displayName: string | null;
  description: string | null;
  version: string | null;
  components: PluginComponents;
  mcpServers: PluginMcpServer[];
}

const PluginJsonSchema = z
  .object({
    name: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    mcpServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    hooks: z.unknown().optional(),
  })
  .passthrough();

const StdioSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const HttpSchema = z.object({
  type: z.enum(['http', 'sse', 'streamable-http']),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** A path inside the plugin, or null when it escapes through `..` or a symlink. */
export function insidePlugin(root: string, relativePath: string): string | null {
  const target = resolve(root, relativePath);
  if (!isInside(root, target)) return null;
  if (!existsSync(target)) return target;
  try {
    return isInside(realpathSync(root), realpathSync(target)) ? target : null;
  } catch {
    return null;
  }
}

/** `${CLAUDE_PLUGIN_ROOT}` becomes the install dir; any other placeholder stays unresolved. */
function expand(value: string, root: string): { value: string; unresolved: boolean } {
  let unresolved = false;
  const expanded = value.replace(PLACEHOLDER, (match, name: string) => {
    if (name === 'CLAUDE_PLUGIN_ROOT') return root;
    unresolved = true;
    return match;
  });
  return { value: expanded, unresolved };
}

/**
 * MCP definitions from `.mcp.json` (either `{ mcpServers: {...} }` or the bare map) or
 * the manifest. An http header that still holds a `${VAR}` is dropped, since the user
 * has not provided that value; stdio env placeholders are kept for the user to fill.
 */
export function parseMcpServers(raw: unknown, root: string): PluginMcpServer[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const map =
    'mcpServers' in raw && typeof raw.mcpServers === 'object' && raw.mcpServers !== null
      ? (raw.mcpServers as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const servers: PluginMcpServer[] = [];
  for (const [name, definition] of Object.entries(map)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_. -]{0,63}$/.test(name)) continue;
    const http = HttpSchema.safeParse(definition);
    if (http.success) {
      const url = expand(http.data.url, root);
      if (url.unresolved) continue;
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(http.data.headers ?? {})) {
        const expanded = expand(value, root);
        if (!expanded.unresolved) headers[key] = expanded.value;
      }
      servers.push({ name, transport: 'http', url: url.value, headers });
      continue;
    }
    const stdio = StdioSchema.safeParse(definition);
    if (!stdio.success) continue;
    servers.push({
      name,
      transport: 'stdio',
      command: expand(stdio.data.command, root).value,
      args: (stdio.data.args ?? []).map((arg) => expand(arg, root).value),
      env: Object.fromEntries(
        Object.entries(stdio.data.env ?? {}).map(([key, value]) => [key, expand(value, root).value]),
      ),
    });
  }
  return servers;
}

function listNames(dir: string, pick: (entry: string, full: string) => string | null): string[] {
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir).toSorted()) {
    const full = join(dir, entry);
    const name = pick(entry, full);
    if (name !== null) names.push(name);
  }
  return names;
}

function skillName(entry: string, full: string): string | null {
  const file = join(full, 'SKILL.md');
  if (!existsSync(file)) return null;
  const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
  const name = parsed?.data.name?.trim();
  return name !== undefined && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) ? name : entry;
}

function markdownName(entry: string, full: string): string | null {
  if (extname(entry).toLowerCase() !== '.md') return null;
  try {
    return statSync(full).isFile() ? basename(entry, extname(entry)) : null;
  } catch {
    return null;
  }
}

export function scanPlugin(root: string): PluginManifest {
  const manifestPath = join(root, '.claude-plugin', 'plugin.json');
  const manifest = PluginJsonSchema.safeParse(readJson(manifestPath));
  const data = manifest.success ? manifest.data : {};

  let mcpRaw: unknown = null;
  if (typeof data.mcpServers === 'string') {
    const file = insidePlugin(root, data.mcpServers);
    mcpRaw = file === null ? null : readJson(file);
  } else if (data.mcpServers !== undefined) {
    mcpRaw = { mcpServers: data.mcpServers };
  } else if (existsSync(join(root, '.mcp.json'))) {
    mcpRaw = readJson(join(root, '.mcp.json'));
  }
  const mcpServers = parseMcpServers(mcpRaw, root);

  const components: PluginComponents = {
    skills: listNames(join(root, 'skills'), skillName),
    commands: listNames(join(root, 'commands'), markdownName),
    mcpServers: mcpServers.map((server) => server.name),
    agents: listNames(join(root, 'agents'), markdownName),
    hooks: data.hooks !== undefined || existsSync(join(root, 'hooks', 'hooks.json')),
  };
  return {
    name: data.name?.trim() || null,
    displayName: data.displayName?.trim() || null,
    description: data.description?.trim() || null,
    version: data.version?.trim() || null,
    components,
    mcpServers,
  };
}
