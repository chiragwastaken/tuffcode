import { Card, CardDescription, CardHeader, CardTitle, Input } from '@tuffcode/ui';
import type { FormEvent } from 'react';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { SettingsSlider } from '../../components/settings/settings-slider';
import { shellFieldError } from '../../components/settings/settings-draft';
import { TOOL_CATALOG, toggleEnabledTool } from '../../components/settings/tool-catalog';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';

const KEYS = ['enabledTools', 'maxToolIterations', 'shell'] as const;

export function AgentsSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);

  const enabledTools = draft?.enabledTools ?? [];
  const shellMessage = draft ? shellFieldError(draft.shell ?? '') : undefined;
  const toolsMessage = enabledTools.length === 0 ? 'Enable at least one tool.' : undefined;
  const invalid = Boolean(shellMessage ?? toolsMessage);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Agents and tools"
        description="What the built-in harness may call in a thread, how long it may keep calling, and the shell it runs commands in. Vendor CLIs keep their own tool sets."
      />

      <Card>
        <CardHeader>
          <CardTitle>Enabled tools</CardTitle>
          <CardDescription>
            Disabled tools are not offered to the model. Reads and searches stay available in
            read-only mode; the permission mode decides what actually runs.
          </CardDescription>
        </CardHeader>

        <ul className="divide-y divide-border border-t border-border">
          {TOOL_CATALOG.map((tool) => {
            const checked = enabledTools.includes(tool.id);
            return (
              <li key={tool.id} className="flex items-start gap-3 px-4 py-2.5">
                <input
                  id={`tool-${tool.id}`}
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 rounded-sm border border-input accent-primary"
                  checked={checked}
                  onChange={(event) =>
                    update({
                      enabledTools: toggleEnabledTool(enabledTools, tool.id, event.target.checked),
                    })
                  }
                />
                <label htmlFor={`tool-${tool.id}`} className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{tool.label}</span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {tool.description}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {toolsMessage ? (
          <p role="alert" className="px-4 pb-3 text-xs leading-5 text-error">
            {toolsMessage}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
          <CardDescription>How long one turn may run before the harness stops.</CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow
            label="Max iterations"
            htmlFor="agents-max-iterations"
            description="Tool calls the harness may make in a single turn. When it hits the cap it stops and reports back instead of looping."
          >
            <SettingsSlider
              id="agents-max-iterations"
              value={draft?.maxToolIterations ?? 40}
              min={1}
              max={100}
              unit="calls"
              onChange={(maxToolIterations) => update({ maxToolIterations })}
            />
          </SettingsRow>

          <SettingsRow
            label="Shell"
            htmlFor="agents-shell"
            description="Executable used for the bash tool and the terminal. Leave blank for the system default."
            error={shellMessage}
          >
            <Input
              id="agents-shell"
              data-testid="settings-shell"
              value={draft?.shell ?? ''}
              onChange={(event) => update({ shell: event.target.value })}
              placeholder="pwsh.exe"
              spellCheck={false}
              aria-invalid={Boolean(shellMessage)}
              aria-describedby={shellMessage ? 'agents-shell-error' : undefined}
            />
          </SettingsRow>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} invalid={invalid} error={error} onReset={reset} />
    </form>
  );
}
