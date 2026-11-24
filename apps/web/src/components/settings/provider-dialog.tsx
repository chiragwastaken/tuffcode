import type { ProviderView } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@tuffcode/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { FormField } from './form-field';
import { InlineAlert } from './inline-alert';
import {
  PROVIDER_KIND_OPTIONS,
  buildProviderPayload,
  isProviderKind,
  providerDraftFromView,
  validateProviderDraft,
  type ProviderDraft,
  type ProviderFieldErrors,
} from './provider-form';

export interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderView | null;
}

const BASE_URL_HINT =
  'Required for OpenAI-compatible endpoints, for example http://127.0.0.1:1234/v1.';
const CLI_BASE_URL_HINT = 'Optional. Leave blank to use the local CLI.';

export function ProviderDialog({ open, onOpenChange, provider }: ProviderDialogProps) {
  const rpc = useRpc();
  const upsertProvider = useAppStore((state) => state.upsertProvider);
  const [draft, setDraft] = useState<ProviderDraft>(() => providerDraftFromView(provider));
  const [errors, setErrors] = useState<ProviderFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(providerDraftFromView(provider));
    setErrors({});
    setServerError(null);
  }, [open, provider]);

  function update<K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]): void {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setServerError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors = validateProviderDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setServerError(null);
    try {
      const payload = buildProviderPayload(draft, {
        id: provider?.id,
        existingConfig: provider?.config,
      });
      const saved = await rpc.request('providers.upsert', payload);
      upsertProvider(saved);
      toast.success(provider ? 'Provider updated.' : 'Provider added.');
      onOpenChange(false);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save the provider.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <DialogTitle>{provider ? 'Edit provider' : 'Add provider'}</DialogTitle>
            <DialogDescription>
              Providers run a local CLI or an HTTP endpoint. The server stores API keys.
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-3">
            <FormField label="Kind" htmlFor="provider-kind" error={errors.kind}>
              <Select
                id="provider-kind"
                options={PROVIDER_KIND_OPTIONS}
                value={draft.kind}
                onValueChange={(value) => {
                  if (value && isProviderKind(value)) update('kind', value);
                }}
              />
            </FormField>

            <FormField label="Label" htmlFor="provider-label" error={errors.label}>
              <Input
                id="provider-label"
                value={draft.label}
                onChange={(event) => update('label', event.target.value)}
                placeholder="Local model"
                aria-invalid={Boolean(errors.label)}
                aria-describedby={errors.label ? 'provider-label-error' : undefined}
              />
            </FormField>

            <FormField
              label="Base URL"
              htmlFor="provider-base-url"
              hint={draft.kind === 'openai-compatible' ? BASE_URL_HINT : CLI_BASE_URL_HINT}
              error={errors.baseUrl}
            >
              <Input
                id="provider-base-url"
                value={draft.baseUrl}
                onChange={(event) => update('baseUrl', event.target.value)}
                placeholder="http://127.0.0.1:1234/v1"
                spellCheck={false}
                aria-invalid={Boolean(errors.baseUrl)}
                aria-describedby={errors.baseUrl ? 'provider-base-url-error' : undefined}
              />
            </FormField>

            <FormField
              label="Model"
              htmlFor="provider-model"
              hint="Optional. Defaults to the provider CLI."
              error={errors.model}
            >
              <Input
                id="provider-model"
                value={draft.model}
                onChange={(event) => update('model', event.target.value)}
                placeholder="claude-opus-4-5"
                spellCheck={false}
                aria-invalid={Boolean(errors.model)}
                aria-describedby={errors.model ? 'provider-model-error' : undefined}
              />
            </FormField>

            <FormField
              label="Headers"
              htmlFor="provider-headers"
              hint='Optional JSON object of string headers, for example {"X-Org": "team"}.'
              error={errors.headers}
            >
              <Textarea
                id="provider-headers"
                value={draft.headers}
                onChange={(event) => update('headers', event.target.value)}
                placeholder={'{\n  "X-Org": "team"\n}'}
                spellCheck={false}
                rows={3}
                className="font-mono text-xs"
                aria-invalid={Boolean(errors.headers)}
                aria-describedby={errors.headers ? 'provider-headers-error' : undefined}
              />
            </FormField>

            <FormField
              label="API key"
              htmlFor="provider-secret"
              hint={
                provider?.hasSecret
                  ? 'A key is saved. Leave this blank to keep it.'
                  : 'Optional. Stored by the server and never sent back to the app.'
              }
              error={errors.secret}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="provider-secret"
                  type="password"
                  autoComplete="off"
                  value={draft.secret}
                  onChange={(event) => update('secret', event.target.value)}
                  placeholder={
                    provider?.hasSecret ? 'Leave blank to keep the saved key' : 'Optional'
                  }
                  spellCheck={false}
                  aria-invalid={Boolean(errors.secret)}
                  aria-describedby={errors.secret ? 'provider-secret-error' : undefined}
                />
                {provider?.hasSecret ? <Badge variant="success">Key saved</Badge> : null}
              </div>
            </FormField>
          </div>

          {serverError ? <InlineAlert>{serverError}</InlineAlert> : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : null}
              {provider ? 'Save provider' : 'Add provider'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
