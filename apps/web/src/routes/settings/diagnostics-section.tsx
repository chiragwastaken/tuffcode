import { LogLevelSchema, type LogLevel } from '@tuffcode/contracts';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  Spinner,
  type SelectOption,
} from '@tuffcode/ui';
import { Copy, Download, FolderOpen } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { InlineAlert } from '../../components/settings/inline-alert';
import { logsFolderFromDbPath } from '../../components/settings/logs-path';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

const KEYS = ['logLevel'] as const;

const LOG_LEVEL_OPTIONS: readonly SelectOption[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

type ExportState =
  | { status: 'idle' }
  | { status: 'exporting' }
  | { status: 'done'; path: string }
  | { status: 'error'; message: string };

async function copyToClipboard(value: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied.`);
  } catch {
    toast.error(`Could not copy the ${what.toLowerCase()}.`);
  }
}

export function DiagnosticsSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const rpc = useRpc();
  const [health, setHealth] = useState<{ dbPath: string } | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    rpc
      .request('app.health', {})
      .then((result) => {
        if (!cancelled) setHealth({ dbPath: result.dbPath });
      })
      .catch(() => {
        // The row falls back to a description when health is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const logsFolder = health ? logsFolderFromDbPath(health.dbPath) : null;

  async function exportDiagnostics(): Promise<void> {
    setExportState({ status: 'exporting' });
    try {
      const result = await rpc.request('diagnostics.export', {});
      setExportState({ status: 'done', path: result.path });
    } catch (caught) {
      setExportState({
        status: 'error',
        message: caught instanceof Error ? caught.message : 'Could not export diagnostics.',
      });
    }
  }

  const systemInfo = [
    `Tuffcode ${bootstrap?.version ?? 'unknown'}`,
    `platform: ${bootstrap?.platform ?? 'unknown'}`,
    `server port: ${bootstrap?.port ?? 'unknown'}`,
    `data folder: ${health?.dbPath ?? 'unknown'}`,
    `logs folder: ${logsFolder ?? 'unknown'}`,
  ].join('\n');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Diagnostics"
        description="Log verbosity and the files to attach to a bug report. Nothing here leaves the machine on its own."
      />

      <Card>
        <CardHeader>
          <CardTitle>Logging</CardTitle>
          <CardDescription>
            Server and adapter log verbosity. Secrets are never logged.
          </CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow label="Log level" htmlFor="diagnostics-log-level">
            <Select
              id="diagnostics-log-level"
              options={LOG_LEVEL_OPTIONS}
              value={draft?.logLevel ?? 'info'}
              onValueChange={(value) => {
                const parsed = LogLevelSchema.safeParse(value);
                if (parsed.success) update({ logLevel: parsed.data as LogLevel });
              }}
            />
          </SettingsRow>

          <SettingsRow
            label="Logs folder"
            description={
              logsFolder
                ? 'Server and adapter logs are written here.'
                : 'The folder appears once the server reports its data path.'
            }
          >
            <div className="flex flex-col gap-2">
              {logsFolder ? (
                <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                  <code className="break-all font-mono text-2xs leading-4 text-foreground">
                    {logsFolder}
                  </code>
                </div>
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logsFolder === null}
                  onClick={() => {
                    if (logsFolder) void copyToClipboard(logsFolder, 'Logs folder path');
                  }}
                >
                  <FolderOpen strokeWidth={1.75} />
                  Copy logs path
                </Button>
              </div>
            </div>
          </SettingsRow>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bundle</CardTitle>
          <CardDescription>
            Write a JSON snapshot of versions, counts, and redacted settings into the logs folder.
          </CardDescription>
        </CardHeader>

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void exportDiagnostics()}
              disabled={exportState.status === 'exporting'}
            >
              {exportState.status === 'exporting' ? (
                <Spinner size="sm" />
              ) : (
                <Download strokeWidth={1.75} />
              )}
              Export diagnostics
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copyToClipboard(systemInfo, 'System info')}
            >
              <Copy strokeWidth={1.75} />
              Copy system info
            </Button>
          </div>

          {exportState.status === 'done' ? (
            <p role="status" className="text-xs leading-5 text-muted-foreground">
              Saved to{' '}
              <code className="break-all font-mono text-2xs text-foreground">
                {exportState.path}
              </code>
            </p>
          ) : null}

          {exportState.status === 'error' ? <InlineAlert>{exportState.message}</InlineAlert> : null}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}
