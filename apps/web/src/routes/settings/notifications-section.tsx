import type { NotificationSettings } from '@tuffcode/contracts';
import { Card, CardDescription, CardHeader, CardTitle } from '@tuffcode/ui';
import type { FormEvent } from 'react';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';
import { Toggle } from './capabilities-section';

const KEYS = ['notifications', 'keepAwake'] as const;

const EVENTS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: 'turnFinished', label: 'Turn finished', description: 'When an agent finishes or fails a turn.' },
  { key: 'approvalNeeded', label: 'Approval needed', description: 'When a tool call waits for your answer.' },
  { key: 'subagentFinished', label: 'Subagent finished', description: 'When a subagent settles.' },
  { key: 'councilEscalation', label: 'Council needs you', description: 'When a council goal fails or needs a decision.' },
];

/** Desktop notifications and keeping the computer awake while agents run. */
export function NotificationsSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);
  const notifications = draft?.notifications;
  const supported = typeof window !== 'undefined' && window.tuffcode?.notify !== undefined;

  function set(key: keyof NotificationSettings, value: boolean): void {
    if (notifications === undefined) return;
    update({ notifications: { ...notifications, [key]: value } });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={handleSubmit} data-testid="notifications-section">
      <SettingsSectionHeader
        title="Notifications"
        description={
          supported
            ? 'Windows notifications for agent work. A click opens the chat it is about.'
            : 'Notifications need the desktop app; this window cannot show them.'
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Notify me when</CardTitle>
        </CardHeader>
        <div className="divide-y divide-border border-t border-border">
          {EVENTS.map((row) => (
            <SettingsRow key={row.key} label={row.label} htmlFor={`notify-${row.key}`} description={row.description}>
              <Toggle id={`notify-${row.key}`} checked={notifications?.[row.key] ?? true} onChange={(value) => set(row.key, value)} />
            </SettingsRow>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
          <CardDescription>How and when notifications appear.</CardDescription>
        </CardHeader>
        <div className="divide-y divide-border border-t border-border">
          <SettingsRow label="Sound" htmlFor="notify-sound" description="Play the system sound with each notification.">
            <Toggle id="notify-sound" checked={notifications?.sound ?? true} onChange={(value) => set('sound', value)} />
          </SettingsRow>
          <SettingsRow
            label="Only when Tuffcode is in the background"
            htmlFor="notify-onlyWhenUnfocused"
            description="Skip notifications while you are looking at the window."
          >
            <Toggle
              id="notify-onlyWhenUnfocused"
              checked={notifications?.onlyWhenUnfocused ?? true}
              onChange={(value) => set('onlyWhenUnfocused', value)}
            />
          </SettingsRow>
          <SettingsRow
            label="Keep computer awake"
            htmlFor="notify-keepAwake"
            description="Prevent sleep while any agent turn is running. The screen may still turn off."
          >
            <Toggle id="notify-keepAwake" checked={draft?.keepAwake ?? false} onChange={(value) => update({ keepAwake: value })} />
          </SettingsRow>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}
