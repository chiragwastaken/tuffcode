import type { ProviderView } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IconButton,
  Spinner,
} from '@tuffcode/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/settings/confirm-dialog';
import { InlineAlert } from '../../components/settings/inline-alert';
import { PROVIDER_KIND_OPTIONS } from '../../components/settings/provider-form';
import { ProviderDialog } from '../../components/settings/provider-dialog';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

type ConnectionState =
  | { status: 'testing' }
  | { status: 'done'; ok: boolean; detail: string }
  | { status: 'failed'; detail: string };

const KIND_LABEL = new Map(PROVIDER_KIND_OPTIONS.map((option) => [option.value, option.label]));

export function ProvidersSection() {
  const providers = useAppStore((state) => state.providers);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const rpc = useRpc();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderView | null>(null);
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({});
  const [deleteTarget, setDeleteTarget] = useState<ProviderView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openAdd(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(provider: ProviderView): void {
    setEditing(provider);
    setConnections((previous) => {
      const next = { ...previous };
      delete next[provider.id];
      return next;
    });
    setDialogOpen(true);
  }

  async function testConnection(provider: ProviderView): Promise<void> {
    setConnections((previous) => ({ ...previous, [provider.id]: { status: 'testing' } }));
    try {
      const result = await rpc.request('providers.test', { id: provider.id });
      setConnections((previous) => ({
        ...previous,
        [provider.id]: { status: 'done', ok: result.ok, detail: result.detail },
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

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="Providers"
        description="Local CLIs and HTTP endpoints that run agent turns. API keys are stored by the server and never shown here."
        actions={addButton}
      />

      {providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="Add a local CLI or an OpenAI-compatible endpoint before creating a thread."
          action={addButton}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((provider) => {
            const connection = connections[provider.id];
            const baseUrl =
              typeof provider.config.baseUrl === 'string' ? provider.config.baseUrl : '';
            const model = typeof provider.config.model === 'string' ? provider.config.model : '';

            return (
              <Card key={provider.id}>
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate">{provider.label}</CardTitle>
                      <Badge>{KIND_LABEL.get(provider.kind) ?? provider.kind}</Badge>
                      {provider.hasSecret ? <Badge variant="success">Key saved</Badge> : null}
                      {provider.enabled ? null : <Badge variant="warning">Disabled</Badge>}
                    </div>
                    <CardDescription className="break-all">
                      {baseUrl || 'Uses the local CLI'}
                      {model ? ` / ${model}` : ''}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void testConnection(provider)}
                      disabled={connection?.status === 'testing'}
                    >
                      {connection?.status === 'testing' ? <Spinner size="sm" /> : null}
                      Test
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(provider)}>
                      Edit
                    </Button>
                    <IconButton
                      icon={Trash2}
                      label={`Remove ${provider.label}`}
                      size="sm"
                      onClick={() => {
                        setDeleteTarget(provider);
                        setDeleteError(null);
                      }}
                    />
                  </div>
                </CardHeader>

                {connection ? (
                  <div className="px-3 pb-3">
                    {connection.status === 'testing' ? (
                      <p className="text-xs text-muted-foreground">Testing connection...</p>
                    ) : connection.status === 'done' ? (
                      <InlineAlert tone={connection.ok ? 'success' : 'error'}>
                        {connection.detail ||
                          (connection.ok ? 'Connection OK.' : 'Connection failed.')}
                      </InlineAlert>
                    ) : (
                      <InlineAlert>{connection.detail}</InlineAlert>
                    )}
                  </div>
                ) : null}
              </Card>
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
