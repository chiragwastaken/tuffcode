import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from '@tuffcode/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { InlineAlert } from '../../components/settings/inline-alert';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';
import { useRpc } from '../../rpc/rpc-context';

const KEYS = ['brainEnabled'] as const;

interface BrainRule {
  id: string;
  kind: string;
  scope: string;
  text: string;
}

type RulesState =
  | { status: 'loading' }
  | { status: 'ready'; rules: BrainRule[] }
  | { status: 'error'; message: string };

export function BrainSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);
  const rpc = useRpc();
  const [rules, setRules] = useState<RulesState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    rpc
      .request('brain.list', { limit: 200 })
      .then((entries) => {
        if (cancelled) return;
        setRules({
          status: 'ready',
          rules: entries
            .filter((entry) => entry.active)
            .map((entry) => ({
              id: entry.id,
              kind: entry.kind,
              scope: entry.scope,
              text: entry.text,
            })),
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setRules({
          status: 'error',
          message: caught instanceof Error ? caught.message : 'Could not load Brain rules.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Brain"
        description="Standing rules and preferences the harness retrieves before a turn. Entries live in the local database and never leave this machine."
      />

      <Card>
        <CardHeader>
          <CardTitle>Injection</CardTitle>
          <CardDescription>
            When enabled, matching rules are injected ahead of your message. The Inspector's Brain
            tab shows exactly what was injected for the open thread.
          </CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow
            label="Brain memory"
            htmlFor="brain-enabled"
            description="Turning this off keeps the rules but stops injecting them."
          >
            <label
              htmlFor="brain-enabled"
              className="flex h-9 items-center gap-2 text-sm text-foreground"
            >
              <input
                id="brain-enabled"
                type="checkbox"
                className="size-4 rounded-sm border border-input accent-primary"
                checked={draft?.brainEnabled ?? false}
                onChange={(event) => update({ brainEnabled: event.target.checked })}
              />
              <span>Inject stored rules into new turns</span>
            </label>
          </SettingsRow>
        </div>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Standing rules</CardTitle>
            <CardDescription>Active entries, newest first.</CardDescription>
          </div>
          {rules.status === 'ready' ? <Badge variant="outline">{rules.rules.length}</Badge> : null}
        </CardHeader>

        {rules.status === 'loading' ? (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <Spinner size="sm" label="Loading Brain rules" />
            Loading rules...
          </div>
        ) : null}

        {rules.status === 'error' ? (
          <div className="border-t border-border px-4 py-3">
            <InlineAlert>{rules.message}</InlineAlert>
          </div>
        ) : null}

        {rules.status === 'ready' && rules.rules.length === 0 ? (
          <div className="border-t border-border px-4 py-3">
            <EmptyState
              title="No rules yet"
              description="Add rules from the Brain tab in the inspector; they are picked up here."
            />
          </div>
        ) : null}

        {rules.status === 'ready' && rules.rules.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border">
            {rules.rules.map((rule) => (
              <li key={rule.id} className="flex flex-col gap-1 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{rule.kind}</Badge>
                  <span className="text-2xs text-muted-foreground">{rule.scope}</span>
                </div>
                <p className="text-sm leading-5 text-foreground">{rule.text}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}
