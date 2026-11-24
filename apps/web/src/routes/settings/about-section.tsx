import { Button, Card, CardDescription, CardHeader, CardTitle, Spinner } from '@tuffcode/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { InlineAlert } from '../../components/settings/inline-alert';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

type ExportState =
  | { status: 'idle' }
  | { status: 'exporting' }
  | { status: 'done'; path: string }
  | { status: 'error'; message: string };

export function AboutSection() {
  const version = useAppStore((state) => state.bootstrap?.version);
  const rpc = useRpc();
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  async function exportDiagnostics(): Promise<void> {
    setExportState({ status: 'exporting' });
    try {
      const result = await rpc.request('diagnostics.export', {});
      setExportState({ status: 'done', path: result.path });
    } catch (error) {
      setExportState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not export diagnostics.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader title="About" description="Build information and local diagnostics." />

      <Card>
        <CardHeader>
          <CardTitle>Tuffcode</CardTitle>
          <CardDescription>Local-first desktop app for agentic coding.</CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow label="Version" description="Desktop app version.">
            <span className="text-sm tabular-nums text-foreground">{version ?? 'Unknown'}</span>
          </SettingsRow>

          <SettingsRow
            label="Diagnostics"
            description="Bundle logs, versions, and redacted configuration into a zip on this machine."
          >
            <div className="flex flex-col gap-2">
              <div>
                <Button
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
              </div>

              {exportState.status === 'done' ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Saved to{' '}
                  <code className="break-all font-mono text-2xs text-foreground">
                    {exportState.path}
                  </code>
                </p>
              ) : null}

              {exportState.status === 'error' ? (
                <InlineAlert>{exportState.message}</InlineAlert>
              ) : null}
            </div>
          </SettingsRow>
        </div>
      </Card>
    </div>
  );
}
