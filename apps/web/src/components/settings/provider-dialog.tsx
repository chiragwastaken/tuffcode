import type { ProviderView } from '@tuffcode/contracts';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  IconButton,
  Spinner,
} from '@tuffcode/ui';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { PresetIcon, ProviderGallery, type SubscriptionCheck } from './provider-gallery';
import { ProviderDetailFields } from './provider-detail-fields';
import {
  authModeOfKind,
  buildProviderPayload,
  providerDraftFromPreset,
  providerDraftFromView,
  validateBaseUrl,
  validateProviderDraft,
  type ProviderDraft,
  type ProviderFieldErrors,
} from './provider-form';
import {
  CUSTOM_OPENAI_PRESET,
  PROVIDER_PRESETS,
  isSubscriptionKind,
  presetForProvider,
  type ProviderPreset,
} from './provider-presets';
import { SubscriptionPanel, type Detection } from './provider-subscription';

export interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderView | null;
}

export function ProviderDialog({ open, onOpenChange, provider }: ProviderDialogProps) {
  const rpc = useRpc();
  const providers = useAppStore((state) => state.providers);
  const upsertProvider = useAppStore((state) => state.upsertProvider);

  const [selected, setSelected] = useState<ProviderPreset | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(() => providerDraftFromView(provider));
  const [errors, setErrors] = useState<ProviderFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<Detection>({ status: 'idle' });
  const [checks, setChecks] = useState<Record<string, SubscriptionCheck | undefined>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [provisionalId, setProvisionalId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [loginOutput, setLoginOutput] = useState('');
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const sessionRef = useRef(0);
  const provisionalRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const loginIdRef = useRef<string | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const draftRef = useRef(draft);
  const selectedRef = useRef(selected);
  const persistRef = useRef<(id: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    draftRef.current = draft;
    selectedRef.current = selected;
  });

  const activeProviderId = provider?.id ?? targetId ?? provisionalId;
  const preset = selected ?? (provider ? presetForProvider(provider) : undefined) ?? null;
  const auth = selected
    ? authModeOfKind(draft.kind, selected)
    : provider
      ? authModeOfKind(provider.kind, preset ?? undefined)
      : 'api-key';
  const isFullForm = provider !== null || selected?.custom === true;
  const showLabel = isFullForm || auth === 'cli';

  useEffect(() => {
    if (!open) return;
    sessionRef.current += 1;
    const session = sessionRef.current;

    provisionalRef.current = null;
    committedRef.current = false;
    loginIdRef.current = null;
    setProvisionalId(null);
    setTargetId(null);
    setLoginId(null);
    setLoginOutput('');
    setLoginRunning(false);
    setLoginError(null);
    setErrors({});
    setServerError(null);
    setSaving(false);
    setDetecting(false);
    setAdvancedOpen(false);
    setChecks({});
    setDetection({ status: 'idle' });

    if (provider) {
      const nextPreset = presetForProvider(provider) ?? CUSTOM_OPENAI_PRESET;
      setSelected(nextPreset);
      setDraft(providerDraftFromView(provider));
      if (isSubscriptionKind(provider.kind)) void runDetection(provider.id, session);
      return;
    }

    setSelected(null);
    setDraft(providerDraftFromPreset(PROVIDER_PRESETS[0]!));
    void loadSubscriptionChecks(session);
  }, [open, provider, rpc]);

  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [loginOutput]);

  useEffect(() => {
    if (!loginId) return;
    const session = sessionRef.current;

    const unsubscribe = rpc.onEvent((event) => {
      if (event.type !== 'provider.login.output' && event.type !== 'provider.login.done') return;
      if (event.payload.loginId !== loginId) return;

      if (event.type === 'provider.login.output') {
        setLoginOutput((previous) => previous + event.payload.chunk);
        return;
      }

      setLoginRunning(false);
      setLoginId(null);
      loginIdRef.current = null;

      if (!event.payload.ok) {
        setLoginError(event.payload.detail || 'Sign-in did not complete.');
        return;
      }

      committedRef.current = true;
      const providerId = event.payload.providerId;
      void (async () => {
        try {
          const result = await rpc.request('providers.test', { id: providerId });
          if (session !== sessionRef.current) return;
          setDetection({
            status: 'done',
            ok: result.ok,
            signedIn: result.signedIn,
            cliPath: result.cliPath,
            detail: result.detail,
          });
          if (result.signedIn === true) await persistRef.current(providerId);
        } catch (error) {
          if (session !== sessionRef.current) return;
          setDetection({
            status: 'error',
            detail: error instanceof Error ? error.message : 'Could not check the sign-in status.',
          });
        }
      })();
    });

    return unsubscribe;
  }, [loginId, rpc]);

  useEffect(() => {
    persistRef.current = persistSubscription;
  });

  async function loadSubscriptionChecks(session: number): Promise<void> {
    const subscriptionProviders = useAppStore
      .getState()
      .providers.filter((entry) => isSubscriptionKind(entry.kind));
    const entries = await Promise.all(
      subscriptionProviders.map(async (entry) => {
        const presetId = presetForProvider(entry)?.id;
        if (!presetId) return null;
        try {
          const result = await rpc.request('providers.test', { id: entry.id });
          return [
            presetId,
            {
              signedIn: result.signedIn,
              cliPath: result.cliPath,
              detail: result.detail,
            },
          ] as const;
        } catch {
          return null;
        }
      }),
    );
    if (session !== sessionRef.current) return;
    const next: Record<string, SubscriptionCheck> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    setChecks(next);
  }

  async function runDetection(id: string, session: number): Promise<void> {
    setDetection({ status: 'checking' });
    try {
      const result = await rpc.request('providers.test', { id });
      if (session !== sessionRef.current) return;
      setDetection({
        status: 'done',
        ok: result.ok,
        signedIn: result.signedIn,
        cliPath: result.cliPath,
        detail: result.detail,
      });
      if (result.signedIn === true) committedRef.current = true;
    } catch (error) {
      if (session !== sessionRef.current) return;
      setDetection({
        status: 'error',
        detail: error instanceof Error ? error.message : 'Could not test the provider.',
      });
    }
  }

  async function prepareSubscription(
    nextPreset: ProviderPreset,
    nextDraft: ProviderDraft,
  ): Promise<void> {
    const session = sessionRef.current;
    const existing = useAppStore
      .getState()
      .providers.find((entry) => presetForProvider(entry)?.id === nextPreset.id);

    if (existing) {
      provisionalRef.current = null;
      setProvisionalId(null);
      setTargetId(existing.id);
      setDraft(providerDraftFromView(existing));
      await runDetection(existing.id, session);
      return;
    }

    try {
      const payload = buildProviderPayload(nextDraft, { preset: nextPreset, isNew: true });
      const saved = await rpc.request('providers.upsert', payload);
      if (session !== sessionRef.current) {
        await rpc.request('providers.remove', { id: saved.id }).catch(() => undefined);
        return;
      }
      upsertProvider(saved);
      provisionalRef.current = saved.id;
      setProvisionalId(saved.id);
      setTargetId(saved.id);
      await runDetection(saved.id, session);
    } catch (error) {
      if (session !== sessionRef.current) return;
      setServerError(error instanceof Error ? error.message : 'Could not start the provider.');
    }
  }

  function handleSelect(nextPreset: ProviderPreset): void {
    const nextDraft = providerDraftFromPreset(nextPreset);
    setSelected(nextPreset);
    setDraft(nextDraft);
    setErrors({});
    setServerError(null);
    setLoginError(null);
    setLoginOutput('');
    setDetection({ status: 'idle' });
    setAdvancedOpen(false);

    if (nextPreset.group === 'subscriptions') void prepareSubscription(nextPreset, nextDraft);
  }

  function update<K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]): void {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key as keyof ProviderFieldErrors];
      return next;
    });
    setServerError(null);
  }

  async function rollbackProvisional(): Promise<void> {
    const id = provisionalRef.current;
    provisionalRef.current = null;
    setProvisionalId(null);
    if (!id || committedRef.current) return;

    try {
      await rpc.request('providers.remove', { id });
      useAppStore.setState((state) => ({
        providers: state.providers.filter((entry) => entry.id !== id),
      }));
    } catch {
      // The provider may already be gone; leave the store untouched.
    }
  }

  function handleOpenChange(next: boolean): void {
    if (next) {
      onOpenChange(true);
      return;
    }

    sessionRef.current += 1;
    const activeLogin = loginIdRef.current;
    loginIdRef.current = null;
    if (activeLogin) {
      void rpc.request('providers.loginCancel', { loginId: activeLogin }).catch(() => undefined);
    }
    void rollbackProvisional();
    onOpenChange(false);
  }

  function handleBack(): void {
    if (provider) return;
    sessionRef.current += 1;
    const session = sessionRef.current;
    const activeLogin = loginIdRef.current;
    loginIdRef.current = null;
    if (activeLogin) {
      void rpc.request('providers.loginCancel', { loginId: activeLogin }).catch(() => undefined);
    }
    void rollbackProvisional();
    setSelected(null);
    setTargetId(null);
    setDetection({ status: 'idle' });
    setErrors({});
    setServerError(null);
    setLoginId(null);
    setLoginOutput('');
    setLoginRunning(false);
    setLoginError(null);
    setAdvancedOpen(false);
    void rollbackProvisional().then(() => {
      if (session === sessionRef.current) void loadSubscriptionChecks(session);
    });
  }

  async function handleSignIn(): Promise<void> {
    if (!activeProviderId) return;
    const session = sessionRef.current;
    setLoginError(null);
    setLoginOutput('');
    setLoginRunning(true);
    setDetection({ status: 'idle' });

    try {
      const result = await rpc.request('providers.login', { id: activeProviderId });
      if (session !== sessionRef.current) {
        await rpc
          .request('providers.loginCancel', { loginId: result.loginId })
          .catch(() => undefined);
        return;
      }
      loginIdRef.current = result.loginId;
      setLoginId(result.loginId);
    } catch (error) {
      setLoginRunning(false);
      setLoginError(error instanceof Error ? error.message : 'Could not start the CLI sign-in.');
    }
  }

  async function handleCancelLogin(): Promise<void> {
    const activeLogin = loginIdRef.current;
    loginIdRef.current = null;
    setLoginId(null);
    setLoginRunning(false);
    if (activeLogin) {
      try {
        await rpc.request('providers.loginCancel', { loginId: activeLogin });
      } catch {
        // The CLI may have already exited.
      }
    }
    setLoginOutput((previous) => `${previous}${previous ? '\n' : ''}[cancelled]\n`);
  }

  async function handleCheckStatus(): Promise<void> {
    if (!activeProviderId) return;
    const session = sessionRef.current;
    setDetection({ status: 'checking' });
    try {
      const result = await rpc.request('providers.test', { id: activeProviderId });
      if (session !== sessionRef.current) return;
      setDetection({
        status: 'done',
        ok: result.ok,
        signedIn: result.signedIn,
        cliPath: result.cliPath,
        detail: result.detail,
      });
      if (result.signedIn === true) {
        committedRef.current = true;
        await persistRef.current(activeProviderId);
        toast.success(`${selectedRef.current?.label ?? 'Provider'} is connected.`);
      } else {
        setLoginError(result.detail || 'The CLI reports that you are not signed in yet.');
      }
    } catch (error) {
      if (session !== sessionRef.current) return;
      setDetection({
        status: 'error',
        detail: error instanceof Error ? error.message : 'Could not check the sign-in status.',
      });
    }
  }

  async function persistSubscription(id: string): Promise<void> {
    const current = useAppStore.getState().providers.find((entry) => entry.id === id);
    const payload = buildProviderPayload(draftRef.current, {
      id,
      preset: selectedRef.current ?? undefined,
      existingConfig: current?.config,
      isNew: false,
      hasExistingSecret: current?.hasSecret,
    });
    const saved = await rpc.request('providers.upsert', payload);
    upsertProvider(saved);
  }

  async function handleDone(): Promise<void> {
    if (!activeProviderId) {
      handleOpenChange(false);
      return;
    }

    setSaving(true);
    setServerError(null);
    try {
      await persistSubscription(activeProviderId);
      committedRef.current = true;
      provisionalRef.current = null;
      toast.success(`${selectedRef.current?.label ?? 'Provider'} is ready.`);
      handleOpenChange(false);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save the provider.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDetect(): Promise<void> {
    const baseUrl = draft.baseUrl.trim();
    if (!baseUrl) {
      setErrors((previous) => ({ ...previous, baseUrl: 'Base URL is required.' }));
      return;
    }
    const baseUrlError = validateBaseUrl(baseUrl);
    if (baseUrlError) {
      setErrors((previous) => ({ ...previous, baseUrl: baseUrlError }));
      return;
    }

    const current = activeProviderId
      ? providers.find((entry) => entry.id === activeProviderId)
      : undefined;
    const currentBaseUrl =
      typeof current?.config.baseUrl === 'string' ? current.config.baseUrl.trim() : '';
    if (provider && currentBaseUrl && currentBaseUrl !== baseUrl) {
      setErrors((previous) => ({
        ...previous,
        baseUrl: 'Save the provider before detecting models on a different endpoint.',
      }));
      return;
    }

    setDetecting(true);
    setServerError(null);
    try {
      let id = current?.id;

      if (!id || currentBaseUrl !== baseUrl) {
        const payload = buildProviderPayload(draft, {
          id,
          preset: selected ?? undefined,
          existingConfig: current?.config,
          isNew: !id,
        });
        const saved = await rpc.request('providers.upsert', payload);
        upsertProvider(saved);
        id = saved.id;
        if (!current) {
          provisionalRef.current = saved.id;
          setProvisionalId(saved.id);
        }
        setTargetId(saved.id);
      }
      if (!id) return;

      const result = await rpc.request('providers.test', { id });
      const found = result.models ?? [];
      if (found.length > 0) {
        const options = found.map((model) => ({ id: model, label: model }));
        setDraft((previous) => ({
          ...previous,
          models: options,
          model: options.some((option) => option.id === previous.model)
            ? previous.model
            : (options[0]?.id ?? ''),
        }));
        toast.success(`Found ${found.length} model${found.length === 1 ? '' : 's'}.`);
      }
      setDetection({
        status: 'done',
        ok: result.ok,
        signedIn: result.signedIn,
        cliPath: result.cliPath,
        detail: result.detail,
      });
      if (!result.ok) setServerError(result.detail);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not detect the endpoint.');
    } finally {
      setDetecting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (auth === 'subscription') return;

    const isNew = provider === null;
    const existingId = provider?.id ?? targetId ?? provisionalId ?? undefined;
    const current = existingId ? providers.find((entry) => entry.id === existingId) : undefined;
    const hasExistingSecret = current?.hasSecret ?? provider?.hasSecret;
    const nextErrors = validateProviderDraft(draft, { isNew, hasExistingSecret });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setServerError(null);
    try {
      const payload = buildProviderPayload(draft, {
        id: existingId,
        preset: selected ?? undefined,
        existingConfig: current?.config,
        isNew,
        hasExistingSecret,
      });
      const saved = await rpc.request('providers.upsert', payload);
      upsertProvider(saved);
      committedRef.current = true;
      provisionalRef.current = null;
      toast.success(provider ? 'Provider updated.' : 'Provider added.');
      handleOpenChange(false);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save the provider.');
    } finally {
      setSaving(false);
    }
  }

  function handleCustomize(): void {
    setSelected(CUSTOM_OPENAI_PRESET);
    setDraft((previous) => ({
      ...previous,
      presetId: CUSTOM_OPENAI_PRESET.id,
      kind: CUSTOM_OPENAI_PRESET.kind,
      label: previous.label || CUSTOM_OPENAI_PRESET.label,
    }));
  }

  const title = provider ? 'Edit provider' : selected ? `Add ${selected.label}` : 'Add provider';
  const description = !selected
    ? 'Pick a subscription, an API provider, a local endpoint, or an agent.'
    : provider
      ? 'Changes apply to new turns. Saved keys are never sent back to the app.'
      : auth === 'subscription'
        ? 'Sign in once. Tuffcode runs the vendor CLI with the plan you already have.'
        : auth === 'local'
          ? 'Tuffcode talks to this endpoint on your machine.'
          : auth === 'cli'
            ? 'The agent process runs locally and speaks ACP over stdio.'
            : 'Your key is stored locally by the server and never shown again.';

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <div className="relative flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="flex min-w-0 items-start gap-3">
              {preset ? (
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <PresetIcon icon={preset.icon} className="size-4" />
                </span>
              ) : null}
              <div className="min-w-0">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </div>
            </div>
            <IconButton icon={X} label="Close" size="sm" onClick={() => handleOpenChange(false)} />
          </div>

          {selected === null ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-8">
                <ProviderGallery checks={checks} onSelect={handleSelect} />
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-popover to-transparent"
              />
            </>
          ) : (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="flex flex-col gap-4">
                  {selected.docsUrl ? (
                    <a
                      href={selected.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                    >
                      Documentation
                      <ExternalLink aria-hidden="true" strokeWidth={1.75} className="size-3" />
                    </a>
                  ) : null}

                  {auth === 'subscription' ? (
                    <SubscriptionPanel
                      preset={selected}
                      draft={draft}
                      errors={errors}
                      detection={detection}
                      loginOutput={loginOutput}
                      loginRunning={loginRunning}
                      loginError={loginError}
                      serverError={serverError}
                      advancedOpen={advancedOpen}
                      outputRef={outputRef}
                      onSignIn={() => void handleSignIn()}
                      onCheckStatus={() => void handleCheckStatus()}
                      onCancelLogin={() => void handleCancelLogin()}
                      onToggleAdvanced={() => setAdvancedOpen((previous) => !previous)}
                      onUpdate={update}
                    />
                  ) : (
                    <ProviderDetailFields
                      preset={selected}
                      auth={auth}
                      draft={draft}
                      errors={errors}
                      isFullForm={isFullForm}
                      showLabel={showLabel}
                      hasSavedSecret={provider?.hasSecret ?? false}
                      detection={detection}
                      serverError={serverError}
                      detecting={detecting}
                      onUpdate={update}
                      onCustomize={handleCustomize}
                      onDetect={() => void handleDetect()}
                    />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border p-4">
                <div>
                  {provider === null ? (
                    <Button variant="ghost" size="sm" onClick={handleBack}>
                      <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
                      Back
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {auth === 'subscription' ? (
                    detection.status === 'done' && detection.signedIn === true ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleSignIn()}
                          disabled={saving || loginRunning}
                        >
                          Sign in again
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => void handleDone()}
                          disabled={saving}
                        >
                          {saving ? <Spinner size="sm" /> : null}
                          Done
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenChange(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    )
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenChange(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" variant="primary" disabled={saving}>
                        {saving ? <Spinner size="sm" /> : null}
                        {provider ? 'Save changes' : 'Add provider'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
