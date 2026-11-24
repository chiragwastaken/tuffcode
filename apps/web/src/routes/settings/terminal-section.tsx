import { CursorStyleSchema } from '@tuffcode/contracts';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  type SelectOption,
} from '@tuffcode/ui';
import type { FormEvent } from 'react';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { SettingsSlider } from '../../components/settings/settings-slider';
import { shellFieldError } from '../../components/settings/settings-draft';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';

const KEYS = ['shell', 'terminalScrollback', 'terminalFontSize', 'cursorStyle'] as const;

const CURSOR_OPTIONS: readonly SelectOption[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
];

const SCROLLBACK_OPTIONS: readonly SelectOption[] = [
  { value: '1000', label: '1,000 lines' },
  { value: '2500', label: '2,500 lines' },
  { value: '5000', label: '5,000 lines' },
  { value: '10000', label: '10,000 lines' },
  { value: '25000', label: '25,000 lines' },
];

export function TerminalSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);

  const shellMessage = draft ? shellFieldError(draft.shell ?? '') : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Terminal"
        description="The shell the in-app terminal starts, and how much history it keeps. New terminals pick these up."
      />

      <Card>
        <CardHeader>
          <CardTitle>Terminal</CardTitle>
          <CardDescription>Applies to the inspector terminal and the bash tool.</CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow
            label="Shell"
            htmlFor="terminal-shell"
            description="Executable to start. Leave blank for the system default."
            error={shellMessage}
          >
            <Input
              id="terminal-shell"
              value={draft?.shell ?? ''}
              onChange={(event) => update({ shell: event.target.value })}
              placeholder="pwsh.exe"
              spellCheck={false}
              aria-invalid={Boolean(shellMessage)}
              aria-describedby={shellMessage ? 'terminal-shell-error' : undefined}
            />
          </SettingsRow>

          <SettingsRow
            label="Scrollback"
            htmlFor="terminal-scrollback"
            description="Lines kept in memory per terminal. Larger values use more memory."
          >
            <Select
              id="terminal-scrollback"
              options={SCROLLBACK_OPTIONS}
              value={String(draft?.terminalScrollback ?? 5000)}
              onValueChange={(value) => {
                if (value === null) return;
                const parsed = Number(value);
                if (Number.isInteger(parsed)) update({ terminalScrollback: parsed });
              }}
            />
          </SettingsRow>

          <SettingsRow
            label="Font size"
            htmlFor="terminal-font-size"
            description="Terminal text size, independent of the interface font size."
          >
            <SettingsSlider
              id="terminal-font-size"
              value={draft?.terminalFontSize ?? 13}
              min={11}
              max={20}
              unit="px"
              onChange={(terminalFontSize) => update({ terminalFontSize })}
            />
          </SettingsRow>

          <SettingsRow label="Cursor style" htmlFor="terminal-cursor">
            <Select
              id="terminal-cursor"
              options={CURSOR_OPTIONS}
              value={draft?.cursorStyle ?? 'bar'}
              onValueChange={(value) => {
                const parsed = CursorStyleSchema.safeParse(value);
                if (parsed.success) update({ cursorStyle: parsed.data });
              }}
            />
          </SettingsRow>
        </div>
      </Card>

      <SaveBar
        dirty={dirty}
        saving={saving}
        invalid={Boolean(shellMessage)}
        error={error}
        onReset={reset}
      />
    </form>
  );
}
