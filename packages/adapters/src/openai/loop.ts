import type { AdapterDeps, AdapterEvent, ApprovalChoice, TurnContext } from '@tuffcode/contracts';
import { TOOL_NAMES, SUBAGENT_TOOL_NAME, type ToolName } from '@tuffcode/prompt';
import { newId } from '@tuffcode/shared';
import {
  OpenAIRequestError,
  type ChatMessage,
  type ChatStreamer,
  type OpenAIToolCall,
} from './client.js';
import { streamSse } from './sse.js';
import {
  classifyExtraTool,
  classifySubagentTool,
  classifyTool,
  executeTool,
  type PermissionDecision,
  type ToolExecResult,
  type ToolSessionState,
} from './tools.js';
import { effectiveToolIterations, isToolDisabled } from '../tool-policy.js';
import { isExtraToolName } from '../extra-tools.js';
import { redactToolInput } from '../redact.js';

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
    return {
      content: '',
      reasoning: '',
      toolCalls: [],
      finishReason: null,
      inputTokens,
      outputTokens,
    };
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
  const maxIterations = effectiveToolIterations(
    ctx.maxToolIterations,
    options.maxIterations,
    MAX_TOOL_ITERATIONS,
  );
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
          {
            model: ctx.model,
            messages: requestMessages(ctx, messages),
            ...(ctx.maxOutputTokens !== undefined ? { maxTokens: ctx.maxOutputTokens } : {}),
            ...(ctx.toolAllowlist !== undefined ? { toolAllowlist: ctx.toolAllowlist } : {}),
            ...(deps.spawnSubagent !== undefined && ctx.permissionMode !== 'read-only'
              ? { subagentTool: true }
              : {}),
            ...(deps.extraTool !== undefined ? { extraTools: true } : {}),
          },
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
          input: redactToolInput(args ?? call.function.arguments),
        };

        let result: ToolExecResult | null = null;
        let decision: PermissionDecision | null = null;
        const name = call.function.name;
        if (parseError !== null) {
          result = { output: parseError, isError: true };
        } else if (name === SUBAGENT_TOOL_NAME) {
          decision = classifySubagentTool(ctx.permissionMode);
        } else if (isExtraToolName(name)) {
          decision = classifyExtraTool(name, args ?? {}, ctx.permissionMode);
        } else if (!isToolName(name)) {
          result = { output: 'unknown tool: ' + name, isError: true };
        } else if (isToolDisabled(name, ctx.toolAllowlist)) {
          result = { output: 'tool "' + name + '" is disabled in settings', isError: true };
        } else {
          decision = classifyTool(name, args ?? {}, ctx.permissionMode);
        }

        if (decision === 'deny') {
          result = {
            output: 'tool is not allowed in ' + ctx.permissionMode + ' mode',
            isError: true,
          };
        } else if (decision === 'approve') {
          const approvalId = newId('apr');
          const pending = options.requestApproval(approvalId);
          yield {
            type: 'approval.requested',
            turnId,
            approvalId,
            toolCallId,
            name,
            input: redactToolInput(args),
          };
          const choice = await pending;
          if (signal.aborted) {
            result = { output: '[interrupted]', isError: true };
          } else if (choice === 'deny') {
            result = { output: 'denied by user', isError: true };
          }
        }
        if (result === null) {
          result = await executeTool(name, args ?? {}, ctx, state, deps, deps.extraTool);
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

/** Kept short: the summary is a fact sheet, not prose the model should imitate. */
export const COMPACTION_SYSTEM_PROMPT =
  'You compress conversation history for another model. Reply with a compact factual ' +
  'summary: decisions made, files and symbols touched, tool results that still matter, ' +
  'and any open questions. No preamble, no markdown headings.';

const MAX_TRANSCRIPT_CHARS = 60_000;

export interface CompactHistoryOptions {
  client: ChatStreamer;
  messages: ChatMessage[];
  model: string;
  deps: AdapterDeps;
  signal: AbortSignal;
}

function renderTranscriptMessage(message: ChatMessage): string {
  const lines = [`[${message.role}] ${message.content ?? ''}`];
  if (message.tool_calls !== undefined && message.tool_calls.length > 0) {
    const calls = message.tool_calls
      .map((call) => `${call.function.name}(${call.function.arguments})`)
      .join('; ');
    lines.push(`tool calls: ${calls}`);
  }
  if (message.tool_call_id !== undefined) lines.push(`tool_call_id: ${message.tool_call_id}`);
  return lines.join(LF);
}

/**
 * Folds every message except the last two into one system message using the same
 * client. A tool result can only follow the assistant message that requested it, so
 * the keep window widens past leading `tool` rows instead of slicing a pair apart.
 */
export async function compactHistory(options: CompactHistoryOptions): Promise<{ removed: number }> {
  const { messages, deps } = options;
  if (messages.length <= 2 || options.model.trim().length === 0) return { removed: 0 };
  let start = messages.length - 2;
  while (start > 0 && messages[start]?.role === 'tool') start -= 1;
  if (start <= 0) return { removed: 0 };

  const older = messages.slice(0, start);
  const keep = messages.slice(start);
  let transcript = older.map(renderTranscriptMessage).join(LF + LF);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = '[earlier history omitted]' + LF + transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }

  try {
    const stream = await options.client.stream(
      {
        model: options.model,
        messages: [
          { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
        toolAllowlist: [],
      },
      options.signal,
    );
    const parts: string[] = [];
    for await (const raw of streamSse(stream, { signal: options.signal, logger: deps.logger })) {
      const chunk = parseChunk(raw);
      if (chunk === null || chunk.content.length === 0) continue;
      parts.push(chunk.content);
    }
    const summary = parts.join('').trim();
    if (summary.length === 0) return { removed: 0 };
    messages.splice(
      0,
      messages.length,
      { role: 'system', content: `Summary of the earlier conversation:${LF}${summary}` },
      ...keep,
    );
    return { removed: older.length };
  } catch (error) {
    deps.logger.warn('openai compaction failed', { reason: errorMessage(error) });
    return { removed: 0 };
  }
}
