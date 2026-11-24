import {
  DEFAULT_SETTINGS,
  LogLevelSchema,
  PermissionModeSchema,
  ThemeSchema,
} from '@tuffcode/contracts';
import {
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
  type SelectOption,
} from '@tuffcode/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { InlineAlert } from '../../components/settings/inline-alert';
import {
  buildSettingsPatch,
  generalDraftFromSettings,
  generalDraftsEqual,
  validateGeneralDraft,
  type GeneralDraft,
} from '../../components/settings/general-form';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

const THEME_OPTIONS: readonly SelectOption[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const PERMISSION_OPTIONS: readonly SelectOption[] = [
  { value: 'read-only', label: 'Read only' },
  { value: 'ask', label: 'Ask before edits' },
  { value: 'accept-edits', label: 'Accept edits' },
  { value: 'full-auto', label: 'Full auto' },
];

const LOG_LEVEL_OPTIONS: readonly SelectOption[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

export function GeneralSection() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const rpc = useRpc();

  const [draft, setDraft] = useState<GeneralDraft>(() =>
    generalDraftFromSettings(settings ?? DEFAULT_SETTINGS),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(generalDraftFromSettings(settings));
  }, [settings]);

  const dirty = settings ? !generalDraftsEqual(draft, generalDraftFromSettings(settings)) : false;
  const errors = validateGeneralDraft(draft);
  const invalid = Object.keys(errors).length > 0;

  function update<K extends keyof GeneralDraft>(key: K, value: GeneralDraft[K]): void {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
    setServerError(null);
  }

  function reset(): void {
    if (!settings) return;
    setDraft(generalDraftFromSettings(settings));
    setSaved(false);
    setServerError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (invalid) return;

    setSaving(true);
    setSaved(false);
    setServerError(null);
    try {
      const next = await rpc.request('settings.set', { patch: buildSettingsPatch(draft) });
      setSettings(next);
      setSaved(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="General"
        description="Appearance, the terminal shell, default permissions, logging, and Brain memory."
      />

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Appearance and runtime</CardTitle>
            <CardDescription>
              These defaults apply to new threads and the whole window.
            </CardDescription>
          </CardHeader>

          <div className="divide-y divide-border border-t border-border">
            <SettingsRow
              label="Theme"
              htmlFor="general-theme"
              description="The desktop window follows this choice."
            >
              <Select
                id="general-theme"
                options={THEME_OPTIONS}
                value={draft.theme}
                onValueChange={(value) => {
                  const parsed = ThemeSchema.safeParse(value);
                  if (parsed.success) update('theme', parsed.data);
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Shell"
              htmlFor="general-shell"
              description="Terminal executable. Leave blank to use the system default."
              error={errors.shell}
            >
              <Input
                id="general-shell"
                value={draft.shell}
                onChange={(event) => update('shell', event.target.value)}
                placeholder="pwsh.exe"
                spellCheck={false}
                aria-invalid={Boolean(errors.shell)}
                aria-describedby={errors.shell ? 'general-shell-error' : undefined}
              />
            </SettingsRow>

            <SettingsRow
              label="Default permission mode"
              htmlFor="general-permission"
              description="Used when a new thread does not pick a mode."
            >
              <Select
                id="general-permission"
                options={PERMISSION_OPTIONS}
                value={draft.defaultPermissionMode}
                onValueChange={(value) => {
                  const parsed = PermissionModeSchema.safeParse(value);
                  if (parsed.success) update('defaultPermissionMode', parsed.data);
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Log level"
              htmlFor="general-log-level"
              description="Server log verbosity. Logs never include secrets."
            >
              <Select
                id="general-log-level"
                options={LOG_LEVEL_OPTIONS}
                value={draft.logLevel}
                onValueChange={(value) => {
                  const parsed = LogLevelSchema.safeParse(value);
                  if (parsed.success) update('logLevel', parsed.data);
                }}
              />
            </SettingsRow>

            <SettingsRow
              label="Brain"
              htmlFor="general-brain"
              description="Inject stored rules and preferences into new turns."
            >
              <label
                htmlFor="general-brain"
                className="flex h-9 items-center gap-2 text-sm text-foreground"
              >
                <input
                  id="general-brain"
                  type="checkbox"
                  className="size-4 rounded-sm border border-input accent-primary"
                  checked={draft.brainEnabled}
                  onChange={(event) => update('brainEnabled', event.target.checked)}
                />
                <span>Enable Brain memory</span>
              </label>
            </SettingsRow>
          </div>

          <CardFooter className="justify-between">
            <span className="text-xs text-muted-foreground">
              {saved ? 'Saved.' : dirty ? 'Unsaved changes.' : 'Settings are up to date.'}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>
                Reset
              </Button>
              <Button type="submit" variant="primary" disabled={!dirty || invalid || saving}>
                {saving ? <Spinner size="sm" /> : null}
                Save changes
              </Button>
            </div>
          </CardFooter>
        </Card>

        {serverError ? <InlineAlert>{serverError}</InlineAlert> : null}
      </form>
    </div>
  );
}
