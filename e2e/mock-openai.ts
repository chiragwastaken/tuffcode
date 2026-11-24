import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimal OpenAI-compatible endpoint for the E2E suite. It streams SSE chunks and
 * answers with tool calls so the real `openai-compatible` adapter runs end to end.
 * Everything stays on 127.0.0.1.
 */

export const MOCK_MODEL_ID = 'mock-model';
export const MOCK_TEXT = 'Hello from the mock provider.';
export const MOCK_DENIED_TEXT = 'The command was denied.';
export const MOCK_ALLOWED_TEXT = 'The command ran successfully.';
export const MOCK_WROTE_TEXT = 'Wrote the file.';
export const MOCK_FILE_PATH = 'e2e-added.txt';
export const MOCK_FILE_CONTENT = 'added by the mock provider';

const LF = String.fromCharCode(10);
const DONE = String.fromCharCode(91, 68, 79, 78, 69, 93);
const CHUNK_DELAY_MS = 15;

export interface MockOpenAI {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: number;
  close(): Promise<void>;
}

interface ChatMessage {
  role?: unknown;
  content?: unknown;
}

interface ChatRequest {
  messages?: unknown;
}

function listen(server: Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      reject(new Error('mock server did not bind a port'));
      return;
    }
    resolve((address as AddressInfo).port);
  });
  return promise;
}

function writeSse(response: ServerResponse, payload: unknown): void {
  response.write('data: ' + JSON.stringify(payload) + LF + LF);
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): unknown {
  return {
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    created: 1,
    model: MOCK_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function usageChunk(): unknown {
  return {
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    created: 1,
    model: MOCK_MODEL_ID,
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function streamText(response: ServerResponse, text: string): Promise<void> {
  const words = text.split(' ');
  for (let index = 0; index < words.length; index += 1) {
    const suffix = index === words.length - 1 ? '' : ' ';
    writeSse(response, chunk({ content: (words[index] ?? '') + suffix }, null));
    await delay(CHUNK_DELAY_MS);
  }
  writeSse(response, chunk({}, 'stop'));
  writeSse(response, usageChunk());
  response.write('data: ' + DONE + LF + LF);
}

function streamToolCall(
  response: ServerResponse,
  id: string,
  name: string,
  args: Record<string, unknown>,
): void {
  writeSse(
    response,
    chunk(
      {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
      null,
    ),
  );
  writeSse(response, chunk({}, 'tool_calls'));
  writeSse(response, usageChunk());
  response.write('data: ' + DONE + LF + LF);
}

function messagesOf(body: ChatRequest): ChatMessage[] {
  return Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
}

function contentOf(message: ChatMessage | undefined): string {
  return typeof message?.content === 'string' ? message.content : '';
}

function lastRole(messages: ChatMessage[], role: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return contentOf(message);
  }
  return '';
}

async function handleChat(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const part of request) {
    chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  }
  let body: ChatRequest = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest;
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'invalid JSON' } }));
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const messages = messagesOf(body);
  const last = messages.at(-1);
  if (last?.role === 'tool') {
    const output = contentOf(last);
    const reply = output.includes('denied')
      ? MOCK_DENIED_TEXT
      : output.startsWith('wrote ')
        ? MOCK_WROTE_TEXT
        : MOCK_ALLOWED_TEXT;
    await streamText(response, reply);
    response.end();
    return;
  }

  const prompt = lastRole(messages, 'user');
  if (prompt.includes('run-bash')) {
    streamToolCall(response, 'call_e2e_bash', 'bash', { command: 'echo tuffcode-ok' });
    response.end();
    return;
  }
  if (prompt.includes('write-file')) {
    streamToolCall(response, 'call_e2e_write', 'write', {
      path: MOCK_FILE_PATH,
      content: MOCK_FILE_CONTENT,
    });
    response.end();
    return;
  }

  await streamText(response, MOCK_TEXT);
  response.end();
}

export async function startMockOpenAI(): Promise<MockOpenAI> {
  let requests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests += 1;
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: MOCK_MODEL_ID, object: 'model' }] }),
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      void handleChat(request, response).catch(() => {
        response.destroy();
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  });

  const port = await listen(server);
  return {
    baseUrl: 'http://127.0.0.1:' + String(port) + '/v1',
    port,
    get requests() {
      return requests;
    },
    close: () => {
      server.closeAllConnections();
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => {
        resolve();
      });
      return promise;
    },
  };
}
