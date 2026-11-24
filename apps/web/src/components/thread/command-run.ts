import type {
  CommandRunResult,
  CommandSettingsSection,
  CommandUiAction,
  ExecutionMode,
  PromptPreview,
} from '@tuffcode/contracts';

/**
 * What the composer can do with a `commands.run` result. Every effect is a port so
 * the dispatch is testable without a DOM: the composer wires these to the model
 * picker, `threads.update`, the router, the inspector and `threads.send`.
 */
export interface CommandPorts {
  openModelPicker(): void;
  switchMode(mode: ExecutionMode): void | Promise<void>;
  openSettings(section: CommandSettingsSection): void;
  showContext(preview: PromptPreview): void;
  /** Reload the transcript after the server rewrote it, then report what changed. */
  reloadTranscript(text: string): void | Promise<void>;
  showText(text: string): void;
  sendTurn(text: string): void | Promise<void>;
  showError(message: string): void;
}

async function dispatchAction(action: CommandUiAction, ports: CommandPorts): Promise<void> {
  switch (action.type) {
    case 'open-model-picker':
      ports.openModelPicker();
      return;
    case 'switch-mode':
      await ports.switchMode(action.mode);
      return;
    case 'open-settings':
      ports.openSettings(action.section);
      return;
    case 'show-context':
      ports.showContext(action.preview);
      return;
    case 'reload-transcript':
      await ports.reloadTranscript(action.text);
      return;
  }
}

/** Carries out one command result: a UI action, a notice, a turn, or an error. */
export async function dispatchCommandResult(
  result: CommandRunResult,
  ports: CommandPorts,
): Promise<void> {
  switch (result.kind) {
    case 'ui':
      await dispatchAction(result.action, ports);
      return;
    case 'text':
      ports.showText(result.text);
      return;
    case 'turn':
      await ports.sendTurn(result.text);
      return;
    case 'error':
      ports.showError(result.message);
      return;
  }
}
