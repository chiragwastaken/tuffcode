import type { Capabilities } from '@tuffcode/contracts';
import { Card } from '@tuffcode/ui';
import type { FormEvent } from 'react';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';

const KEYS = ['capabilities', 'brainEnabled'] as const;

const ROWS: { key: keyof Capabilities; label: string; description: string }[] = [
  { key: 'skills', label: 'Skills', description: '$name loads a skill into the message; other skills load on demand with the skill tool.' },
  { key: 'connectors', label: 'Connectors (MCP)', description: 'Enabled MCP servers and their tools are offered to agents.' },
  { key: 'subagents', label: 'Subagents', description: 'Agents may spawn, steer, wait for and stop typed subagents.' },
  { key: 'todo', label: 'Task list', description: 'Agents keep a live todo list for multi-step work.' },
  { key: 'webFetch', label: 'Web fetch', description: 'Agents may read public web pages. Asks first in Ask mode; private hosts are refused.' },
  { key: 'browser', label: 'Browser tab', description: 'The built-in browser panel for previews and docs.' },
  { key: 'worktrees', label: 'Worktrees', description: 'New chats get their own git worktree. Off works directly in the project checkout.' },
];

/** Real switches for what agents may use. Council threads always keep every tool. */
export function CapabilitiesSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  const capabilities = draft?.capabilities;

  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={handleSubmit} data-testid="capabilities-section">
      <SettingsSectionHeader
        title="Capabilities"
        description="Turn features on or off for every new turn. Council goals ignore these switches so the council can coordinate with every tool."
      />
      <Card>
        <div className="divide-y divide-border">
          <SettingsRow label="Brain memory" htmlFor="cap-brain" description="Recall and save memories. Manage them in Your Tuffcode.">
            <Toggle
              id="cap-brain"
              checked={draft?.brainEnabled ?? true}
              onChange={(checked) => update({ brainEnabled: checked })}
            />
          </SettingsRow>
          {ROWS.map((row) => (
            <SettingsRow key={row.key} label={row.label} htmlFor={`cap-${row.key}`} description={row.description}>
              <Toggle
                id={`cap-${row.key}`}
                checked={capabilities?.[row.key] ?? true}
                onChange={(checked) => {
                  if (capabilities === undefined) return;
                  update({ capabilities: { ...capabilities, [row.key]: checked } });
                }}
              />
            </SettingsRow>
          ))}
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}

export function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex h-9 items-center gap-2 text-sm text-foreground">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        data-testid={id}
        className="size-4 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {checked ? 'On' : 'Off'}
    </label>
  );
}
