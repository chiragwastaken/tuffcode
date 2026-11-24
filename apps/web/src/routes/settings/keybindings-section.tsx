import { Badge, Card, CardDescription, CardHeader, CardTitle, EmptyState, Kbd } from '@tuffcode/ui';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useAppStore } from '../../store/app-store';

function formatAction(action: string): string {
  const words = action
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

export function KeybindingsSection() {
  const settings = useAppStore((state) => state.settings);
  const entries = Object.entries(settings?.keybindings ?? {}).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="Keybindings"
        description="The shortcuts this build reports. Editing them arrives in a later release."
        actions={<Badge variant="outline">Read only</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Keyboard shortcuts</CardTitle>
          <CardDescription>Bindings come from the server settings.</CardDescription>
        </CardHeader>

        {entries.length === 0 ? (
          <div className="px-3 pb-3">
            <EmptyState
              title="No keybindings"
              description="This build does not report any custom shortcuts yet."
            />
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {entries.map(([action, keys]) => (
              <div key={action} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className="text-sm text-foreground">{formatAction(action)}</span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {keys
                    .split(/[|,]/)
                    .map((key) => key.trim())
                    .filter(Boolean)
                    .map((key) => (
                      <Kbd key={`${action}-${key}`}>{key}</Kbd>
                    ))}
                  {keys.trim() ? null : (
                    <span className="text-xs text-muted-foreground">Unbound</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
