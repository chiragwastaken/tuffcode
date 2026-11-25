import { UpdateChannelSchema, type UpdateChannel } from '@tuffcode/contracts';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  buttonVariants,
  type SelectOption,
} from '@tuffcode/ui';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import {
  checkForUpdatesNow,
  describeUpdateOutcome,
} from '../../components/settings/updates-check';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';
import { useAppStore } from '../../store/app-store';
import type { UpdateCheckOutcome } from '../../types';

const KEYS = ['updateChannel', 'checkUpdatesOnStart'] as const;

const CHANNEL_OPTIONS: readonly SelectOption[] = [
  { value: 'stable', label: 'Stable' },
  { value: 'beta', label: 'Beta' },
];

const RELEASE_NOTES_URL = 'https://github.com/tuffcode-net/tuffcode/releases';

function formatCheckedAt(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function UpdatesSection() {
  const version = useAppStore((state) => state.bootstrap?.version);
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);
  const [result, setResult] = useState<UpdateCheckOutcome | null>(null);
  const [checking, setChecking] = useState(false);

  const channel: UpdateChannel = draft?.updateChannel ?? 'stable';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  async function handleCheck(): Promise<void> {
    setChecking(true);
    try {
      setResult(await checkForUpdatesNow({ bridge: window.tuffcode }));
    } finally {
      setChecking(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Updates"
        description="Which release channel this install follows and whether it checks at launch."
      />

      <Card>
        <CardHeader>
          <CardTitle>This build</CardTitle>
          <CardDescription>Version reported by the desktop app.</CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow label="Current version">
            <span className="flex h-9 items-center text-sm tabular-nums text-foreground">
              {version ?? 'Unknown'}
            </span>
          </SettingsRow>

          <SettingsRow
            label="Channel"
            htmlFor="updates-channel"
            description="Beta builds may include unfinished features."
          >
            <Select
              id="updates-channel"
              options={CHANNEL_OPTIONS}
              value={channel}
              onValueChange={(value) => {
                const parsed = UpdateChannelSchema.safeParse(value);
                if (parsed.success) update({ updateChannel: parsed.data });
              }}
            />
          </SettingsRow>

          <SettingsRow
            label="Check at launch"
            htmlFor="updates-check-on-start"
            description="Ask the update feed once when the app starts."
          >
            <label
              htmlFor="updates-check-on-start"
              className="flex h-9 items-center gap-2 text-sm text-foreground"
            >
              <input
                id="updates-check-on-start"
                type="checkbox"
                className="size-4 rounded-sm border border-input accent-primary"
                checked={draft?.checkUpdatesOnStart ?? false}
                onChange={(event) => update({ checkUpdatesOnStart: event.target.checked })}
              />
              <span>Check for updates on launch</span>
            </label>
          </SettingsRow>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Check now</CardTitle>
          <CardDescription>
            Packaged builds check on launch, download in the background, and ask you to restart
            when the update is ready.
          </CardDescription>
        </CardHeader>

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={() => void handleCheck()}
            >
              <RefreshCw strokeWidth={1.75} className={checking ? 'animate-spin' : undefined} />
              {checking ? 'Checking...' : 'Check for updates'}
            </Button>
            <a
              href={RELEASE_NOTES_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <ExternalLink strokeWidth={1.75} />
              Release notes
            </a>
          </div>

          {result ? (
            <p role="status" className="text-xs leading-5 text-muted-foreground">
              Checked at {formatCheckedAt(result.checkedAt)}: {describeUpdateOutcome(result)}
            </p>
          ) : null}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}
