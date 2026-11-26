import type { NotificationSettings } from '@tuffcode/contracts';
import { Button, Card, CardDescription, CardHeader, CardTitle, Spinner } from '@tuffcode/ui';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { testNotificationRequest } from '../../components/notifications/notification-model';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';
import { useAppStore } from '../../store/app-store';
import type { NotifyTestResult } from '../../types';
import { Toggle } from './capabilities-section';

const KEYS = ['notifications', 'keepAwake'] as const;

const EVENTS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: 'turnFinished', label: 'Turn finished', description: 'When an agent finishes or fails a turn.' },
  { key: 'approvalNeeded', label: 'Approval needed', description: 'When a tool call waits for your answer.' },
  { key: 'subagentFinished', label: 'Subagent finished', description: 'When a subagent settles.' },
  { key: 'councilEscalation', label: 'Council needs you', description: 'When a council goal fails or needs a decision.' },
];

type TestState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'done'; result: NotifyTestResult }
  | { status: 'error'; message: string };

const SUPPRESSION_NOTE =
  'If no banner appeared, Windows Focus Assist, quiet hours, or the Tuffcode notification toggle can suppress it even though the app sent it.';

/** Desktop notifications and keeping the computer awake while agents run. */
export function NotificationsSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);
  const notifications = draft?.notifications;
  const supported = typeof window !== 'undefined' && window.tuffcode?.notify !== undefined;
  const canTest = typeof window !== 'undefined' && window.tuffcode?.notifyTest !== undefined;
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });

  function set(key: keyof NotificationSettings, value: boolean): void {
    if (notifications === undefined) return;
    update({ notifications: { ...notifications, [key]: value } });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  async function sendTestNotification(): Promise<void> {
    const bridge = window.tuffcode;
    if (bridge?.notifyTest === undefined) {
      setTestState({ status: 'error', message: 'This build cannot send test notifications.' });
      return;
    }
    setTestState({ status: 'sending' });
    try {
      // A real thread gives the click somewhere to land; an empty store means no route.
      const threads = useAppStore.getState().threads;
      const result = await bridge.notifyTest(
        testNotificationRequest(threads, !(notifications?.sound ?? true)),
      );
      setTestState({ status: 'done', result });
    } catch (sendError) {
      setTestState({
        status: 'error',
        message: sendError instanceof Error ? sendError.message : String(sendError),
      });
    }
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
          <SettingsRow
            label="Test notification"
            description="Send one now to check that Windows shows Tuffcode notifications."
          >
            <div className="flex flex-col gap-2">
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="notify-test-button"
                  disabled={!canTest || testState.status === 'sending'}
                  onClick={() => void sendTestNotification()}
                >
                  {testState.status === 'sending' ? (
                    <Spinner size="sm" label="Sending notification" />
                  ) : null}
                  Send test notification
                </Button>
              </div>
              {testState.status === 'done' &&
              testState.result.supported &&
              testState.result.shown ? (
                <div role="status" data-testid="notify-test-result" className="flex flex-col gap-1">
                  <p className="text-xs leading-5 text-foreground">Test notification sent.</p>
                  <p className="text-xs leading-5 text-muted-foreground">{SUPPRESSION_NOTE}</p>
                </div>
              ) : null}
              {testState.status === 'done' &&
              (!testState.result.supported || !testState.result.shown) ? (
                <div role="alert" data-testid="notify-test-result" className="flex flex-col gap-1">
                  <p className="text-xs leading-5 text-error">
                    {testState.result.supported
                      ? 'The system accepted the request but the notification was not shown.'
                      : 'This system does not support desktop notifications.'}
                  </p>
                  {testState.result.error !== undefined ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {testState.result.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {testState.status === 'error' ? (
                <p
                  role="alert"
                  data-testid="notify-test-result"
                  className="text-xs leading-5 text-error"
                >
                  Could not send a test notification: {testState.message}
                </p>
              ) : null}
            </div>
          </SettingsRow>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}
