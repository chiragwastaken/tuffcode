import { describe, expect, it } from 'vitest';
import type { CommandRunResult, PromptPreview } from '@tuffcode/contracts';
import { dispatchCommandResult, type CommandPorts } from './command-run';

interface Recorder {
  ports: CommandPorts;
  calls: string[];
}

function recorder(): Recorder {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      openModelPicker: () => calls.push('open-model-picker'),
      switchMode: (mode) => {
        calls.push(`switch-mode:${mode}`);
      },
      openSettings: (section) => calls.push(`open-settings:${section}`),
      showContext: (preview) => calls.push(`show-context:${preview.total}`),
      reloadTranscript: (text) => {
        calls.push(`reload-transcript:${text}`);
      },
      showText: (text) => calls.push(`text:${text}`),
      sendTurn: (text) => {
        calls.push(`turn:${text}`);
      },
      showError: (message) => calls.push(`error:${message}`),
    },
  };
}

const preview: PromptPreview = { sections: [], total: 42 };

describe('dispatchCommandResult', () => {
  it('opens the model picker', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult({ kind: 'ui', action: { type: 'open-model-picker' } }, ports);
    expect(calls).toEqual(['open-model-picker']);
  });

  it('switches the execution mode', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult(
      { kind: 'ui', action: { type: 'switch-mode', mode: 'council' } },
      ports,
    );
    expect(calls).toEqual(['switch-mode:council']);
  });

  it('opens a settings section', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult(
      { kind: 'ui', action: { type: 'open-settings', section: 'instructions' } },
      ports,
    );
    expect(calls).toEqual(['open-settings:instructions']);
  });

  it('shows the context panel with the server preview', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult({ kind: 'ui', action: { type: 'show-context', preview } }, ports);
    expect(calls).toEqual(['show-context:42']);
  });

  it('reloads the transcript after a clear or compact', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult(
      { kind: 'ui', action: { type: 'reload-transcript', text: 'Cleared 2 messages.' } },
      ports,
    );
    expect(calls).toEqual(['reload-transcript:Cleared 2 messages.']);
  });

  it('shows text without sending it', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult({ kind: 'text', text: 'Plan mode is on.' }, ports);
    expect(calls).toEqual(['text:Plan mode is on.']);
  });

  it('sends a turn', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult({ kind: 'turn', text: 'Review src/app.ts' }, ports);
    expect(calls).toEqual(['turn:Review src/app.ts']);
  });

  it('reports an error', async () => {
    const { ports, calls } = recorder();
    await dispatchCommandResult({ kind: 'error', message: 'Unknown subagent type' }, ports);
    expect(calls).toEqual(['error:Unknown subagent type']);
  });

  it('awaits an async port before the next effect', async () => {
    const order: string[] = [];
    const ports: CommandPorts = {
      ...recorder().ports,
      sendTurn: async (text) => {
        await Promise.resolve();
        order.push(`sent:${text}`);
      },
    };
    await dispatchCommandResult({ kind: 'turn', text: 'go' }, ports);
    expect(order).toEqual(['sent:go']);
  });
});

it('keeps the result union exhaustive at compile time', () => {
  const results: CommandRunResult[] = [
    { kind: 'ui', action: { type: 'open-model-picker' } },
    { kind: 'text', text: '' },
    { kind: 'turn', text: '' },
    { kind: 'error', message: '' },
  ];
  expect(results).toHaveLength(4);
});
