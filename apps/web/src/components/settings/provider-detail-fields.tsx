import { Badge, Button, Input, Select, Spinner, Textarea } from '@tuffcode/ui';
import { useMemo } from 'react';
import { FormField } from './form-field';
import { InlineAlert } from './inline-alert';
import type { ProviderDraft, ProviderFieldErrors } from './provider-form';
import type { ProviderAuthMode, ProviderPreset } from './provider-presets';
import type { Detection } from './provider-subscription';

export interface ProviderDetailFieldsProps {
  preset: ProviderPreset;
  auth: ProviderAuthMode;
  draft: ProviderDraft;
  errors: ProviderFieldErrors;
  isFullForm: boolean;
  showLabel: boolean;
  hasSavedSecret: boolean;
  detection: Detection;
  serverError: string | null;
  detecting: boolean;
  onUpdate: <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => void;
  onCustomize: () => void;
  onDetect: () => void;
}

/** Fields for API, local, agent, and custom providers. Subscriptions use their own panel. */
export function ProviderDetailFields({
  preset,
  auth,
  draft,
  errors,
  isFullForm,
  showLabel,
  hasSavedSecret,
  detection,
  serverError,
  detecting,
  onUpdate,
  onCustomize,
  onDetect,
}: ProviderDetailFieldsProps) {
  const modelOptions = useMemo(() => {
    const options = draft.models.map((model) => ({
      value: model.id,
      label: model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id,
    }));
    if (draft.model && !draft.models.some((model) => model.id === draft.model)) {
      options.unshift({ value: draft.model, label: `${draft.model} (custom)` });
    }
    return options;
  }, [draft.model, draft.models]);

  return (
    <div className="flex flex-col gap-3">
      {showLabel ? (
        <FormField label="Label" htmlFor="provider-label" error={errors.label}>
          <Input
            id="provider-label"
            data-testid="provider-label-input"
            value={draft.label}
            onChange={(event) => onUpdate('label', event.target.value)}
            placeholder={preset.label}
            aria-invalid={Boolean(errors.label)}
            aria-describedby={errors.label ? 'provider-label-error' : undefined}
          />
        </FormField>
      ) : null}

      {auth === 'cli' ? (
        <div className="flex flex-col gap-3">
          <FormField
            label="Command"
            htmlFor="provider-command"
            hint={
              draft.kind === 'opencode'
                ? 'Defaults to `opencode acp`.'
                : 'For example `agy` or `npx some-acp-agent`.'
            }
            error={errors.command}
          >
            <Input
              id="provider-command"
              value={draft.command}
              onChange={(event) => onUpdate('command', event.target.value)}
              placeholder={draft.kind === 'opencode' ? 'opencode' : 'agy'}
              spellCheck={false}
              aria-invalid={Boolean(errors.command)}
              aria-describedby={errors.command ? 'provider-command-error' : undefined}
            />
          </FormField>
          <FormField
            label="Model"
            htmlFor="provider-model"
            hint="Optional. Defaults to the agent's own choice."
            error={errors.model}
          >
            <Input
              id="provider-model"
              value={draft.model}
              onChange={(event) => onUpdate('model', event.target.value)}
              placeholder="Agent default"
              spellCheck={false}
            />
          </FormField>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <FormField
            label="Base URL"
            htmlFor="provider-base-url"
            hint={
              isFullForm || auth === 'local'
                ? 'The endpoint root, including /v1 when the API requires it.'
                : 'Fixed by this preset.'
            }
            error={errors.baseUrl}
          >
            <Input
              id="provider-base-url"
              data-testid="provider-base-url-input"
              value={draft.baseUrl}
              onChange={(event) => onUpdate('baseUrl', event.target.value)}
              readOnly={!isFullForm && auth !== 'local'}
              aria-readonly={!isFullForm && auth !== 'local'}
              spellCheck={false}
              className="font-mono text-xs"
              aria-invalid={Boolean(errors.baseUrl)}
              aria-describedby={errors.baseUrl ? 'provider-base-url-error' : undefined}
            />
          </FormField>
          {!isFullForm && preset.group === 'api' ? (
            <Button variant="ghost" size="sm" className="-mt-1 self-start" onClick={onCustomize}>
              Use a custom base URL
            </Button>
          ) : null}

          {auth === 'api-key' ? (
            <FormField
              label="API key"
              htmlFor="provider-secret"
              hint={
                hasSavedSecret
                  ? 'A key is saved. Leave this blank to keep it.'
                  : 'Stored by the server and never sent back to the app.'
              }
              error={errors.secret}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="provider-secret"
                  data-testid="provider-secret-input"
                  type="password"
                  autoComplete="off"
                  value={draft.secret}
                  onChange={(event) => onUpdate('secret', event.target.value)}
                  placeholder={hasSavedSecret ? 'Leave blank to keep it' : 'API key'}
                  spellCheck={false}
                  aria-invalid={Boolean(errors.secret)}
                  aria-describedby={errors.secret ? 'provider-secret-error' : undefined}
                />
                {hasSavedSecret ? <Badge variant="success">Key saved</Badge> : null}
              </div>
            </FormField>
          ) : null}

          <FormField
            label="Model"
            htmlFor="provider-model"
            hint={
              auth === 'local'
                ? 'Detect lists the models this endpoint serves.'
                : 'Prefilled from the preset. Type another id if needed.'
            }
            error={errors.model}
          >
            <div className="flex items-center gap-2">
              {draft.models.length > 0 ? (
                <Select
                  id="provider-model"
                  options={modelOptions}
                  value={draft.model || null}
                  onValueChange={(value) => {
                    if (value) onUpdate('model', value);
                  }}
                  placeholder="Choose a model"
                />
              ) : (
                <Input
                  id="provider-model"
                  data-testid="provider-model-input"
                  value={draft.model}
                  onChange={(event) => onUpdate('model', event.target.value)}
                  placeholder="model-id"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.model)}
                  aria-describedby={errors.model ? 'provider-model-error' : undefined}
                />
              )}
              {auth === 'local' ? (
                <Button variant="outline" onClick={onDetect} disabled={detecting}>
                  {detecting ? <Spinner size="sm" /> : null}
                  Detect
                </Button>
              ) : null}
            </div>
          </FormField>

          {isFullForm && auth !== 'local' ? (
            <FormField
              label="Headers"
              htmlFor="provider-headers"
              hint='Optional JSON object of string headers, for example {"X-Org": "team"}.'
              error={errors.headers}
            >
              <Textarea
                id="provider-headers"
                value={draft.headers}
                onChange={(event) => onUpdate('headers', event.target.value)}
                placeholder={'{\n  "X-Org": "team"\n}'}
                spellCheck={false}
                rows={3}
                className="font-mono text-xs"
                aria-invalid={Boolean(errors.headers)}
                aria-describedby={errors.headers ? 'provider-headers-error' : undefined}
              />
            </FormField>
          ) : null}
        </div>
      )}

      {detection.status === 'done' && auth === 'local' ? (
        <InlineAlert tone={detection.ok ? 'success' : 'error'}>{detection.detail}</InlineAlert>
      ) : null}
      {detection.status === 'error' ? <InlineAlert>{detection.detail}</InlineAlert> : null}
      {serverError ? <InlineAlert>{serverError}</InlineAlert> : null}
    </div>
  );
}
