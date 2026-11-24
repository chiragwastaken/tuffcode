import type { ProviderView } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from '@tuffcode/ui';
import { Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/settings/confirm-dialog';
import { ProviderDialog } from '../../components/settings/provider-dialog';
import {
  authModeLabel,
  defaultModelOf,
  providerAuthMode,
  providerGroup,
  providerKindLabel,
  type ProviderGroup,
} from '../../components/settings/provider-presets';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

type ConnectionState =
  | { status: 'testing' }
  | {
      status: 'done';
      ok: boolean;
      signedIn?: boolean;
      cliPath?: string;
      detail: string;
    }
  | { status: 'failed'; detail: string };

const GROUP_ORDER: readonly ProviderGroup[] = ['subscriptions', 'api', 'local', 'agents'];

const GROUP_TITLE: Record<ProviderGroup, string> = {
  subscriptions: 'Subscriptions',
  api: 'API providers',
  local: 'Local',
  agents: 'Agents',
};

export function ProvidersSection() {
  const providers = useAppStore((state) => state.providers);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const rpc = useRpc();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderView | null>(null);
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({});
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openAdd(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(provider: ProviderView): void {
    setEditing(provider);
    setDialogOpen(true);
  }

  async function testConnection(provider: ProviderView): Promise<void> {
    setConnections((previous) => ({ ...previous, [provider.id]: { status: 'testing' } }));
    try {
      const result = await rpc.request('providers.test', { id: provider.id });
      setConnections((previous) => ({
        ...previous,
        [provider.id]: {
          status: 'done',
          ok: result.ok,
          signedIn: result.signedIn,
          cliPath: result.cliPath,
          detail: result.detail,
        },
      }));
    } catch (error) {
      setConnections((previous) => ({
        ...previous,
        [provider.id]: {
          status: 'failed',
          detail: error instanceof Error ? error.message : 'Could not test the provider.',
        },
      }));
    }
  }

  async function setDefault(provider: ProviderView): Promise<void> {
    setPendingDefault(provider.id);
    try {
      const next = await rpc.request('settings.set', {
        patch: {
          defaultProviderId: provider.id,
          defaultModelId: defaultModelOf(provider) || null,
        },
      });
      setSettings(next);
      toast.success(`${provider.label} is the default provider.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not set the default provider.');
    } finally {
      setPendingDefault(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const target = deleteTarget;

    setDeleting(true);
    setDeleteError(null);
    try {
      await rpc.request('providers.remove', { id: target.id });
      useAppStore.setState((state) => ({
        providers: state.providers.filter((provider) => provider.id !== target.id),
      }));
      setConnections((previous) => {
        const next = { ...previous };
        delete next[target.id];
        return next;
      });

      if (settings?.defaultProviderId === target.id) {
        try {
          const next = await rpc.request('settings.set', {
            patch: { defaultProviderId: null, defaultModelId: null },
          });
          setSettings(next);
        } catch {
          toast.error('Removed the provider, but could not clear the default model.');
        }
      }

      toast.success(`Removed ${target.label}.`);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not remove the provider.');
    } finally {
      setDeleting(false);
    }
  }

  const addButton = (
    <Button variant="primary" size="sm" onClick={openAdd}>
      <Plus strokeWidth={1.75} />
      Add provider
    </Button>
  );

  const grouped = new Map<ProviderGroup, ProviderView[]>(GROUP_ORDER.map((group) => [group, []]));
  for (const provider of providers) grouped.get(providerGroup(provider))?.push(provider);

  return (
    <div className="flex flex-col gap-5">
      <SettingsSectionHeader
        title="Providers"
        description="Subscriptions reuse the vendor CLI and your plan. API providers use a key stored by the server. Multiple providers of any kind can coexist."
        actions={addButton}
      />

      {providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="Add a subscription, an API provider, a local endpoint, or an agent before creating a thread."
          action={addButton}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {GROUP_ORDER.map((group) => {
            const rows = grouped.get(group) ?? [];
            if (rows.length === 0) return null;

            return (
              <section key={group} aria-labelledby={`providers-group-${group}`}>
                <div className="flex items-center justify-between pb-2">
                  <h3
                    id={`providers-group-${group}`}
                    className="text-sm font-semibold text-foreground"
                  >
                    {GROUP_TITLE[group]}
                  </h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {rows.map((provider) => {
                    const connection = connections[provider.id];
                    const auth = providerAuthMode(provider);
                    const defaultModel = defaultModelOf(provider);
                    const isDefault = settings?.defaultProviderId === provider.id;

                    return (
                      <Card key={provider.id}>
                        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="truncate">{provider.label}</CardTitle>
                              <Badge>{providerKindLabel(provider.kind)}</Badge>
                              <Badge variant={auth === 'subscription' ? 'primary' : 'neutral'}>
                                {authModeLabel(auth)}
                              </Badge>
                              {isDefault ? <Badge variant="success">Default</Badge> : null}
                              {provider.hasSecret ? (
                                <Badge variant="success">Key saved</Badge>
                              ) : null}
                              {provider.enabled ? null : <Badge variant="warning">Disabled</Badge>}
                            </div>
                            <CardDescription className="break-all">
                              {defaultModel ? `Default model: ${defaultModel}` : 'No default model'}
                            </CardDescription>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-muted-foreground">Last test:</span>
                              {connection === undefined ? (
                                <span className="text-muted-foreground">Not tested</span>
                              ) : connection.status === 'testing' ? (
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <Spinner size="sm" />
                                  Testing...
                                </span>
                              ) : connection.status === 'failed' ? (
                                <>
                                  <Badge variant="error">Failed</Badge>
                                  <span
                                    className="min-w-0 truncate text-muted-foreground"
                                    title={connection.detail}
                                  >
                                    {connection.detail}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Badge variant={connection.ok ? 'success' : 'error'}>
                                    {connection.ok ? 'OK' : 'Failed'}
                                  </Badge>
                                  {connection.signedIn === true ? (
                                    <Badge variant="success">Signed in</Badge>
                                  ) : connection.signedIn === false ? (
                                    <Badge variant="warning">Not signed in</Badge>
                                  ) : null}
                                  <span
                                    className="min-w-0 truncate text-muted-foreground"
                                    title={connection.cliPath ?? connection.detail}
                                  >
                                    {connection.cliPath ?? connection.detail}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void testConnection(provider)}
                              disabled={connection?.status === 'testing'}
                            >
                              <RefreshCw strokeWidth={1.75} />
                              Test
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void setDefault(provider)}
                              disabled={isDefault || pendingDefault !== null}
                            >
                              <Star strokeWidth={1.75} />
                              {isDefault ? 'Default' : 'Set default'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(provider)}>
                              <Pencil strokeWidth={1.75} />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDeleteTarget(provider);
                                setDeleteError(null);
                              }}
                            >
                              <Trash2 strokeWidth={1.75} />
                              Delete
                            </Button>
                          </div>
                        </CardHeader>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} provider={editing} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title="Remove provider?"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.label}? Threads that use it will need another provider.`
            : ''
        }
        confirmLabel="Remove provider"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
