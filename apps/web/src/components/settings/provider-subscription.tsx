import { Badge, Button, Input, Spinner } from '@tuffcode/ui';
import type { RefObject } from 'react';
import { FormField } from './form-field';
import { InlineAlert } from './inline-alert';
import type { ProviderDraft, ProviderFieldErrors } from './provider-form';
import { configDirLabel, type ProviderPreset } from './provider-presets';

export type Detection =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; ok: boolean; signedIn?: boolean; cliPath?: string; detail: string }
  | { status: 'error'; detail: string };

export interface SubscriptionPanelProps {
  preset: ProviderPreset;
  draft: ProviderDraft;
  errors: ProviderFieldErrors;
  detection: Detection;
  loginOutput: string;
  loginRunning: boolean;
  loginError: string | null;
  serverError: string | null;
  advancedOpen: boolean;
  outputRef: RefObject<HTMLPreElement | null>;
  onSignIn: () => void;
  onCheckStatus: () => void;
  onCancelLogin: () => void;
  onToggleAdvanced: () => void;
  onUpdate: <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => void;
}

/** The whole subscription experience: detection, CLI sign-in stream, and advanced overrides. */
export function SubscriptionPanel({
  preset,
  draft,
  errors,
  detection,
  loginOutput,
  loginRunning,
  loginError,
  serverError,
  advancedOpen,
  outputRef,
  onSignIn,
  onCheckStatus,
  onCancelLogin,
  onToggleAdvanced,
  onUpdate,
}: SubscriptionPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          CLI status
        </p>
        {detection.status === 'checking' ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner size="sm" />
            Checking the CLI...
          </span>
        ) : detection.status === 'done' ? (
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              {detection.signedIn === true ? (
                <Badge variant="success">Signed in</Badge>
              ) : detection.signedIn === false ? (
                <Badge variant="warning">Not signed in</Badge>
              ) : (
                <Badge>{detection.ok ? 'CLI detected' : 'Not available'}</Badge>
              )}
              <span
                className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                title={detection.cliPath ?? detection.detail}
              >
                {detection.cliPath ?? detection.detail}
              </span>
            </span>
            {!detection.ok ? <InlineAlert>{detection.detail}</InlineAlert> : null}
          </div>
        ) : detection.status === 'error' ? (
          <InlineAlert>{detection.detail}</InlineAlert>
        ) : (
          <p className="text-xs text-muted-foreground">Not checked yet.</p>
        )}
      </div>

      {detection.status === 'done' && detection.signedIn === true ? (
        <InlineAlert tone="success">
          Signed in. This provider is saved and ready to run.
        </InlineAlert>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={onSignIn} disabled={loginRunning}>
              {loginRunning ? <Spinner size="sm" /> : null}
              Sign in with {preset.label}
            </Button>
            {loginRunning ? null : (
              <Button
                variant="outline"
                onClick={onCheckStatus}
                disabled={detection.status === 'checking'}
              >
                Check status
              </Button>
            )}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            The CLI opens a browser window. Tuffcode never sees your password.
          </p>
        </div>
      )}

      {loginRunning || loginOutput ? (
        <div className="flex flex-col gap-2">
          <pre
            ref={outputRef}
            role="log"
            aria-live="polite"
            className="max-h-56 overflow-y-auto rounded-md border border-border bg-terminal-background p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-terminal-foreground"
          >
            {loginOutput || 'Waiting for the CLI...'}
          </pre>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onCheckStatus}
              disabled={detection.status === 'checking'}
            >
              Check status
            </Button>
            {loginRunning ? (
              <Button size="sm" variant="ghost" onClick={onCancelLogin}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {loginError ? <InlineAlert>{loginError}</InlineAlert> : null}
      {serverError ? <InlineAlert>{serverError}</InlineAlert> : null}

      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="self-start" onClick={onToggleAdvanced}>
          {advancedOpen ? 'Hide advanced' : 'Advanced'}
        </Button>
        {advancedOpen ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Model override"
              htmlFor="provider-model-override"
              hint="Optional. Leave blank to use the CLI default."
              error={errors.model}
            >
              <Input
                id="provider-model-override"
                value={draft.model}
                onChange={(event) => onUpdate('model', event.target.value)}
                placeholder={preset.defaultModel ?? 'CLI default'}
                spellCheck={false}
              />
            </FormField>
            <FormField
              label={`Config directory (${configDirLabel(draft.kind)})`}
              htmlFor="provider-config-dir"
              hint="Optional. Point the CLI at a separate config."
              error={errors.configDir}
            >
              <Input
                id="provider-config-dir"
                value={draft.configDir}
                onChange={(event) => onUpdate('configDir', event.target.value)}
                placeholder="Default"
                spellCheck={false}
              />
            </FormField>
          </div>
        ) : null}
      </div>
    </div>
  );
}
