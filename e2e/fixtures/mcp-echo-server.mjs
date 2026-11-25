#!/usr/bin/env node
import { createInterface } from 'node:readline';

/**
 * Minimal stdio MCP server for the E2E suite: newline-delimited JSON-RPC 2.0
 * with initialize, one echo tool and tools/call. It never touches the network.
 */

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'mcp-echo-fixture', version: '1.0.0' };
const TOOLS = [
  {
    name: 'echo',
    description: 'Returns the text it was given.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to echo back.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function callEcho(id, args) {
  const text = typeof args.text === 'string' ? args.text : '';
  reply(id, { content: [{ type: 'text', text }], isError: false });
}

function handle(message) {
  if (message === null || typeof message !== 'object') return;
  const { id, method, params } = message;
  if (typeof method !== 'string') return;
  // A notification has no id and never gets a response.
  if (id === undefined) return;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = params?.name;
      if (name !== 'echo') {
        fail(id, -32602, 'unknown tool: ' + String(name));
        return;
      }
      callEcho(id, params?.arguments ?? {});
      return;
    }
    default:
      fail(id, -32601, 'method not found: ' + method);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(parsed);
});
lines.on('close', () => {
  process.exit(0);
});
