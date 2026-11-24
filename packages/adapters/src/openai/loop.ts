import type { AdapterDeps, AdapterEvent, ApprovalChoice, TurnContext } from '@tuffcode/contracts';
import { TOOL_NAMES, type ToolName } from '@tuffcode/prompt';
import { newId } from '@tuffcode/shared';
import {
  OpenAIRequestError,
  type ChatMessage,
  type ChatStreamer,
  type OpenAIToolCall,
} from './client.js';
import { streamSse } from './sse.js';
import { classifyTool, executeTool, type ToolExecResult, type ToolSessionState } from './tools.js';

export const MAX_TOOL_ITERATIONS = 40;
const LF = String.fromCharCode(10);

export interface RunTurnOptions {
  ctx: TurnContext;
  client: ChatStreamer;
  messages: ChatMessage[];
  state: ToolSessionState;
  deps: AdapterDeps;
  signal: AbortSignal;
  requestApproval: (approvalId: string) => Promise<ApprovalChoice>;
  maxIterations?: number;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

interface ToolCallDelta {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
  );
}

function parseToolCallDelta(value: unknown, fallbackIndex: number): ToolCallDelta {
  if (typeof value !== 'object' || value === null) {
    return { index: fallbackIndex, id: '', name: '', arguments: '' };
  }
  const record = value as Record<string, unknown>;
  const index = typeof record.index === 'number' ? record.index : fallbackIndex;
  const id = typeof record.id === 'string' ? record.id : '';
  let name = '';
  let args = '';
  const fn = record.function;
  if (typeof fn === 'object' && fn !== null) {
    const fnRecord = fn as Record<string, unknown>;
    if (typeof fnRecord.name === 'string') name = fnRecord.name;
    if (typeof fnRecord.arguments === 'string') args = fnRecord.arguments;
  }
  return { index, id, name, arguments: args };
}

function accumulateCall(calls: Map<number, ToolCallAccumulator>, delta: ToolCallDelta): void {
  const existing = calls.get(delta.index) ?? { id: '', name: '', arguments: '' };
  if (delta.id.length > 0) existing.id = delta.id;
  if (delta.name.length > 0) {
    if (existing.name.length === 0) existing.name = delta.name;
    else if (existing.name !== delta.name) existing.name += delta.name;
  }
  existing.arguments += delta.arguments;
  calls.set(delta.index, existing);
}

function requestMessages(ctx: TurnContext, messages: ChatMessage[]): ChatMessage[] {
  const system = [ctx.systemPrompt.trim(), ctx.brainSlice.trim()]
    .filter((part) => part.length > 0)
    .join(LF + LF);
  return system.length > 0 ? [{ role: 'system', content: system }, ...messages] : [...messages];
}

interface ChunkDelta {
  content: string;
  reasoning: string;
  toolCalls: unknown[];
  finishReason: string | null;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

function parseChunk(value: unknown): ChunkDelta | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const usage = record.usage;
  if (typeof usage === 'object' && usage !== null) {
    const usageRecord = usage as Record<string, unknown>;
    if (typeof usageRecord.prompt_tokens === 'number') inputTokens = usageRecord.prompt_tokens;
    if (typeof usageRecord.completion_tokens === 'number') {
      outputTokens = usageRecord.completion_tokens;
    }
  }
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: '', reasoning: '', toolCalls: [], finishReason: null, inputTokens, outputTokens };
  }
  const choice = choices[0];
  if (typeof choice !== 'object' || choice === null) return null;
  const choiceRecord = choice as Record<string, unknown>;
  const finishReason =
    typeof choiceRecord.finish_reason === 'string' ? choiceRecord.finish_reason : null;
  const delta = choiceRecord.delta;
  if (typeof delta !== 'object' || delta === null) {
    return { content: '', reasoning: '', toolCalls: [], finishReason, inputTokens, outputTokens };
  }
  const deltaRecord = delta as Record<string, unknown>;
  const content = typeof deltaRecord.content === 'string' ? deltaRecord.content : '';
  const reasoning =
    typeof deltaRecord.reasoning_content === 'string'
      ? deltaRecord.reasoning_content
      : typeof deltaRecord.reasoning === 'string'
        ? deltaRecord.reasoning
        : '';
  const toolCalls = Array.isArray(deltaRecord.tool_calls) ? deltaRecord.tool_calls : [];
  return { content, reasoning, toolCalls, finishReason, inputTokens, outputTokens };
}

export async function* runTurn(options: RunTurnOptions): AsyncIterable<AdapterEvent> {
  const { ctx, client, messages, state, deps, signal } = options;
  const turnId = ctx.turnId;
  const maxIterations = options.maxIterations ?? MAX_TOOL_ITERATIONS;
  let reason: 'complete' | 'interrupted' | 'error' = 'complete';
  let completed = false;

  try {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (signal.aborted) {
        reason = 'interrupted';
        break;
      }

      let stream: ReadableStream<Uint8Array>;
      try {
        stream = await client.stream(
          { model: ctx.model, messages: requestMessages(ctx, messages) },
          signal,
        );
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          reason = 'interrupted';
          break;
        }
        const retryable = error instanceof OpenAIRequestError ? error.retryable : true;
        yield { type: 'error', message: 'openai: ' + errorMessage(error), retryable };
        reason = 'error';
        break;
      }
      const textParts: string[] = [];
      const calls = new Map<number, ToolCallAccumulator>();
      let finishReason: string | null = null;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      try {
        for await (const raw of streamSse(stream, { signal, logger: deps.logger })) {
          const chunk = parseChunk(raw);
          if (chunk === null) continue;
          if (chunk.inputTokens !== undefined) inputTokens = chunk.inputTokens;
          if (chunk.outputTokens !== undefined) outputTokens = chunk.outputTokens;
          if (chunk.content.length > 0) {
            textParts.push(chunk.content);
            yield { type: 'text.delta', turnId, text: chunk.content };
          }
          if (chunk.reasoning.length > 0) {
            yield { type: 'reasoning.delta', turnId, text: chunk.reasoning };
          }
          for (const rawCall of chunk.toolCalls) {
            accumulateCall(calls, parseToolCallDelta(rawCall, calls.size));
          }
          if (chunk.finishReason !== null) finishReason = chunk.finishReason;
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          reason = 'interrupted';
          break;
        }
        yield { type: 'error', message: 'openai: ' + errorMessage(error), retryable: true };
        reason = 'error';
        break;
      }

      if (signal.aborted) {
        reason = 'interrupted';
        break;
      }

      if (inputTokens !== undefined || outputTokens !== undefined) {
        yield {
          type: 'usage',
          turnId,
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        };
      }
      if (finishReason !== null) {
        deps.logger.debug('openai stream finished', { turnId, finishReason });
      }

      const ordered = [...calls.entries()]
        .toSorted((left, right) => left[0] - right[0])
        .map(([, call]) => call);

      if (ordered.length === 0) {
        messages.push({ role: 'assistant', content: textParts.join('') });
        completed = true;
        break;
      }

      const assistantCalls: OpenAIToolCall[] = ordered.map((call) => ({
        id: call.id.length > 0 ? call.id : newId('call'),
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
      messages.push({
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('') : null,
        tool_calls: assistantCalls,
      });

      for (const call of assistantCalls) {
        const toolCallId = call.id;
        if (signal.aborted) {
          messages.push({ role: 'tool', tool_call_id: toolCallId, content: '[interrupted]' });
          continue;
        }

        let args: Record<string, unknown> | null = null;
        let parseError: string | null = null;
        try {
          const parsed: unknown =
            call.function.arguments.length === 0 ? {} : JSON.parse(call.function.arguments);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          } else {
            parseError = 'tool arguments must be a JSON object';
          }
        } catch (error) {
          parseError = 'invalid tool arguments: ' + errorMessage(error);
        }
        yield {
          type: 'tool.started',
          turnId,
          toolCallId,
          name: call.function.name,
          input: args ?? call.function.arguments,
        };

        let result: ToolExecResult;
        const name = call.function.name;
        if (parseError !== null) {
          result = { output: parseError, isError: true };
        } else if (!isToolName(name)) {
          result = { output: 'unknown tool: ' + name, isError: true };
        } else {
          const decision = classifyTool(name, args ?? {}, ctx.permissionMode);
          if (decision === 'deny') {
            result = {
              output: 'tool is not allowed in ' + ctx.permissionMode + ' mode',
              isError: true,
            };
          } else if (decision === 'approve') {
            const approvalId = newId('apr');
            const pending = options.requestApproval(approvalId);
            yield { type: 'approval.requested', turnId, approvalId, toolCallId, name, input: args };
            const choice = await pending;
            if (signal.aborted) {
              result = { output: '[interrupted]', isError: true };
            } else if (choice === 'deny') {
              result = { output: 'denied by user', isError: true };
            } else {
              result = await executeTool(name, args ?? {}, ctx, state, deps);
            }
          } else {
            result = await executeTool(name, args ?? {}, ctx, state, deps);
          }
        }

        yield {
          type: 'tool.finished',
          turnId,
          toolCallId,
          output: result.output,
          isError: result.isError,
        };
        messages.push({ role: 'tool', tool_call_id: toolCallId, content: result.output });
      }

      if (signal.aborted) {
        reason = 'interrupted';
        break;
      }
      deps.logger.debug('openai tool iteration', { turnId, iteration });
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      reason = 'interrupted';
    } else {
      deps.logger.warn('openai turn failed', { turnId });
      yield { type: 'error', message: 'openai: ' + errorMessage(error), retryable: false };
      reason = 'error';
    }
  }

  if (!completed && reason === 'complete') {
    reason = 'error';
    yield {
      type: 'error',
      message: `openai: stopped after ${maxIterations} tool iterations`,
      retryable: false,
    };
  }

  yield { type: 'turn.finished', turnId, reason };
}
