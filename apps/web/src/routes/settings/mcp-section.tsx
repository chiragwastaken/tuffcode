import type { McpServer } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Spinner,
  Textarea,
} from '@tuffcode/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../components/settings/confirm-dialog';
import { FormField } from '../../components/settings/form-field';
import { InlineAlert } from '../../components/settings/inline-alert';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useRpc } from '../../rpc/rpc-context';
import {
  buildMcpUpsertParams,
  emptyMcpDraft,
  mcpDraftFromServer,
  validateMcpDraft,
  type McpDraft,
  type McpFieldErrors,
} from './mcp-form';

type ServersState =
  | { status: 'loading' }
  | { status: 'ready'; servers: McpServer[] }
  | { status: 'error'; message: string };

type TestState =
  | { status: 'running' }
  | { status: 'done'; ok: boolean; detail: string; toolCount: number }
  | { status: 'error'; message: string };

interface RemoveTarget {
  server: McpServer;
  busy: boolean;
  error: string | null;
}

function commandLine(server: McpServer): string {
  return [server.command, ...server.args].join(' ');
}

export function McpSection() {
  const rpc = useRpc();
  const [servers, setServers] = useState<ServersState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [errors, setErrors] = useState<McpFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc
      .request('mcp.list', {})
      .then((entries) => {
        if (cancelled) return;
        setServers({ status: 'ready', servers: entries });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setServers({
          status: 'error',
          message: caught instanceof Error ? caught.message : 'Could not load MCP servers.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, reloadToken]);

  function reload(): void {
    setReloadToken((previous) => previous + 1);
  }

  function openAdd(): void {
    setDraft(emptyMcpDraft());
    setErrors({});
    setFormError(null);
  }

  function openEdit(server: McpServer): void {
    setDraft(mcpDraftFromServer(server));
    setErrors({});
    setFormError(null);
  }

  function closeForm(): void {
    setDraft(null);
    setErrors({});
    setFormError(null);
  }

  function updateDraft<K extends keyof McpDraft>(key: K, value: McpDraft[K]): void {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key as keyof McpFieldErrors];
      return next;
    });
    setFormError(null);
  }

  function setRowError(serverId: string, message: string | null): void {
    setRowErrors((previous) => {
      const next = { ...previous };
      if (message) next[serverId] = message;
      else delete next[serverId];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;

    const nextErrors = validateMcpDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setFormError(null);
    try {
      await rpc.request('mcp.upsert', buildMcpUpsertParams(draft));
      closeForm();
      reload();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the MCP server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(server: McpServer): Promise<void> {
    setRowError(server.id, null);
    setTests((previous) => ({ ...previous, [server.id]: { status: 'running' } }));
    try {
      const result = await rpc.request('mcp.test', { id: server.id });
      setTests((previous) => ({
        ...previous,
        [server.id]: {
          status: 'done',
          ok: result.ok,
          detail: result.detail,
          toolCount: result.tools.length,
        },
      }));
    } catch (error) {
      setTests((previous) => ({
        ...previous,
        [server.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not test the MCP server.',
        },
      }));
    }
  }

  async function handleToggle(server: McpServer): Promise<void> {
    setTogglingId(server.id);
    setRowError(server.id, null);
    try {
      await rpc.request('mcp.upsert', {
        id: server.id,
        label: server.label,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
        enabled: !server.enabled,
      });
      reload();
    } catch (error) {
      setRowError(
        server.id,
        error instanceof Error ? error.message : 'Could not update the MCP server.',
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!removeTarget) return;
    setRemoveTarget({ ...removeTarget, busy: true, error: null });
    try {
      await rpc.request('mcp.remove', { id: removeTarget.server.id });
      setRemoveTarget(null);
      reload();
    } catch (error) {
      setRemoveTarget((previous) =>
        previous
          ? {
              ...previous,
              busy: false,
              error: error instanceof Error ? error.message : 'Could not remove the MCP server.',
            }
          : previous,
      );
    }
  }

  const list = servers.status === 'ready' ? servers.servers : [];

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="MCP"
        description="MCP servers are local stdio processes Tuffcode starts for extra tools. They run on this machine, see only the environment and working directory you give them, and reach the agent through the mcp tool."
        actions={
          <Button
            size="sm"
            variant="secondary"
            data-testid="mcp-add-server"
            onClick={openAdd}
            disabled={draft !== null}
          >
            Add server
          </Button>
        }
      />

      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle>{draft.id ? 'Edit server' : 'Add server'}</CardTitle>
            <CardDescription>
              The command runs as a local stdio process with these arguments.
            </CardDescription>
          </CardHeader>
          <form
            className="flex flex-col border-t border-border"
            onSubmit={(event) => void handleSubmit(event)}
            noValidate
          >
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Label" htmlFor="mcp-label" error={errors.label}>
                  <Input
                    id="mcp-label"
                    data-testid="mcp-label-input"
                    value={draft.label}
                    onChange={(event) => updateDraft('label', event.target.value)}
                    placeholder="Filesystem"
                    aria-invalid={Boolean(errors.label)}
                    aria-describedby={errors.label ? 'mcp-label-error' : undefined}
                  />
                </FormField>
                <FormField
                  label="Command"
                  htmlFor="mcp-command"
                  hint="For example npx or node."
                  error={errors.command}
                >
                  <Input
                    id="mcp-command"
                    data-testid="mcp-command-input"
                    value={draft.command}
                    onChange={(event) => updateDraft('command', event.target.value)}
                    placeholder="npx"
                    spellCheck={false}
                    className="font-mono text-xs"
                    aria-invalid={Boolean(errors.command)}
                    aria-describedby={errors.command ? 'mcp-command-error' : undefined}
                  />
                </FormField>
              </div>

              <FormField
                label="Arguments"
                htmlFor="mcp-args"
                hint="Space separated; one argument per line also works."
              >
                <Textarea
                  id="mcp-args"
                  value={draft.args}
                  onChange={(event) => updateDraft('args', event.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem C:/work"
                  spellCheck={false}
                  rows={2}
                  className="min-h-0 font-mono text-xs"
                />
              </FormField>

              <FormField
                label="Environment"
                htmlFor="mcp-env"
                hint='Optional JSON object of string values, for example {"LOG_LEVEL": "info"}. Credential-like keys are rejected; set those in the server config.'
                error={errors.env}
              >
                <Textarea
                  id="mcp-env"
                  value={draft.env}
                  onChange={(event) => updateDraft('env', event.target.value)}
                  placeholder={'{\n  "LOG_LEVEL": "info"\n}'}
                  spellCheck={false}
                  rows={3}
                  className="min-h-0 font-mono text-xs"
                  aria-invalid={Boolean(errors.env)}
                  aria-describedby={errors.env ? 'mcp-env-error' : undefined}
                />
              </FormField>

              <div className="grid items-center gap-3 sm:grid-cols-2">
                <FormField
                  label="Working directory"
                  htmlFor="mcp-cwd"
                  hint="Optional absolute path the server starts in."
                  error={errors.cwd}
                >
                  <Input
                    id="mcp-cwd"
                    value={draft.cwd}
                    onChange={(event) => updateDraft('cwd', event.target.value)}
                    placeholder="Default"
                    spellCheck={false}
                    className="font-mono text-xs"
                    aria-invalid={Boolean(errors.cwd)}
                    aria-describedby={errors.cwd ? 'mcp-cwd-error' : undefined}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 rounded-sm border border-input accent-primary"
                    checked={draft.enabled}
                    onChange={(event) => updateDraft('enabled', event.target.checked)}
                  />
                  Enabled
                </label>
              </div>
            </div>

            {formError ? (
              <div className="border-t border-border p-3">
                <InlineAlert>{formError}</InlineAlert>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-border p-3">
              <Button type="button" variant="ghost" size="sm" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                {saving ? <Spinner size="sm" /> : null}
                {draft.id ? 'Save changes' : 'Add server'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Servers</CardTitle>
            <CardDescription>
              Each enabled server starts on demand and lists the tools it offers.
            </CardDescription>
          </div>
          {servers.status === 'ready' ? <Badge variant="outline">{list.length}</Badge> : null}
        </CardHeader>

        {servers.status === 'loading' ? (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <Spinner size="sm" label="Loading MCP servers" />
            Loading servers...
          </div>
        ) : null}

        {servers.status === 'error' ? (
          <div className="border-t border-border px-4 py-3">
            <InlineAlert>{servers.message}</InlineAlert>
          </div>
        ) : null}

        {servers.status === 'ready' && list.length === 0 ? (
          <div className="border-t border-border px-4 py-3">
            <EmptyState
              title="No MCP servers yet"
              description="MCP servers are local stdio processes. Add one with a command such as npx and the server package as its arguments."
            />
          </div>
        ) : null}

        {list.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border">
            {list.map((server) => {
              const test = tests[server.id];
              const rowError = rowErrors[server.id];
              return (
                <li key={server.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{server.label}</span>
                        {server.enabled ? null : <Badge variant="outline">Disabled</Badge>}
                      </div>
                      <span
                        className="min-w-0 truncate font-mono text-2xs text-muted-foreground"
                        title={commandLine(server)}
                      >
                        {commandLine(server)}
                      </span>
                      {server.cwd ? (
                        <span
                          className="min-w-0 truncate font-mono text-2xs text-muted-foreground"
                          title={server.cwd}
                        >
                          cwd {server.cwd}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <label className="flex h-8 items-center gap-2 pr-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="size-4 rounded-sm border border-input accent-primary"
                          checked={server.enabled}
                          disabled={togglingId === server.id}
                          aria-label={`Enable ${server.label}`}
                          onChange={() => void handleToggle(server)}
                        />
                        Enabled
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleTest(server)}
                        disabled={test?.status === 'running'}
                      >
                        {test?.status === 'running' ? <Spinner size="sm" /> : null}
                        Test
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(server)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemoveTarget({ server, busy: false, error: null })}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {test?.status === 'done' ? (
                    <InlineAlert tone={test.ok ? 'success' : 'error'}>
                      {test.ok ? 'OK' : 'Failed'}: {test.detail} ({test.toolCount} tool
                      {test.toolCount === 1 ? '' : 's'})
                    </InlineAlert>
                  ) : null}
                  {test?.status === 'error' ? <InlineAlert>{test.message}</InlineAlert> : null}
                  {rowError ? <InlineAlert>{rowError}</InlineAlert> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove MCP server"
        description={
          removeTarget
            ? `Tuffcode will stop starting ${removeTarget.server.label} and its tools.`
            : ''
        }
        confirmLabel="Remove"
        busy={removeTarget?.busy ?? false}
        error={removeTarget?.error ?? null}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
