import type { Model } from '@tuffcode/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  Spinner,
  buttonVariants,
  type SelectOption,
} from '@tuffcode/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { InlineAlert } from '../../components/settings/inline-alert';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';

type ModelsState =
  | { status: 'loading' }
  | { status: 'ready'; models: Model[] }
  | { status: 'error'; message: string };

export function ModelsSection() {
  const providers = useAppStore((state) => state.providers);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const rpc = useRpc();

  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelsState>>({});
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [errorsByProvider, setErrorsByProvider] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    if (providers.length === 0) {
      setModelsByProvider({});
      return () => {
        cancelled = true;
      };
    }

    setModelsByProvider(
      Object.fromEntries(
        providers.map((provider) => [provider.id, { status: 'loading' } as ModelsState]),
      ),
    );

    void Promise.all(
      providers.map(async (provider): Promise<[string, ModelsState]> => {
        try {
          const models = await rpc.request('models.list', { providerId: provider.id });
          return [provider.id, { status: 'ready', models }];
        } catch (error) {
          return [
            provider.id,
            {
              status: 'error',
              message: error instanceof Error ? error.message : 'Could not load models.',
            },
          ];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setModelsByProvider(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [providers, rpc]);

  async function saveDefault(providerId: string, modelId: string | null): Promise<void> {
    setPendingProviderId(providerId);
    setErrorsByProvider((previous) => {
      const next = { ...previous };
      delete next[providerId];
      return next;
    });

    try {
      const next = await rpc.request('settings.set', {
        patch:
          modelId === null
            ? { defaultProviderId: null, defaultModelId: null }
            : { defaultProviderId: providerId, defaultModelId: modelId },
      });
      setSettings(next);
    } catch (error) {
      setErrorsByProvider((previous) => ({
        ...previous,
        [providerId]: error instanceof Error ? error.message : 'Could not save the default model.',
      }));
    } finally {
      setPendingProviderId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="Models"
        description="Pick the model new threads start with. Tuffcode keeps one default provider and model; choosing a model here makes its provider the default."
      />

      {providers.length === 0 ? (
        <EmptyState
          title="No providers yet"
          description="Add a provider before choosing a default model."
          action={
            <Link
              to="/settings/{-$section}"
              params={{ section: 'providers' }}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Go to Providers
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((provider) => {
            const state = modelsByProvider[provider.id];
            const isDefault = settings?.defaultProviderId === provider.id;
            const currentModelId = isDefault ? (settings?.defaultModelId ?? null) : null;
            const models = state?.status === 'ready' ? state.models : [];
            const options: SelectOption[] = models.map((model) => ({
              value: model.modelId,
              label:
                model.label && model.label !== model.modelId
                  ? `${model.label} (${model.modelId})`
                  : model.modelId,
            }));

            if (currentModelId && !models.some((model) => model.modelId === currentModelId)) {
              options.unshift({ value: currentModelId, label: `${currentModelId} (not reported)` });
            }

            return (
              <Card key={provider.id}>
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{provider.label}</CardTitle>
                      {isDefault ? <Badge variant="primary">Default</Badge> : null}
                    </div>
                    <CardDescription>
                      {isDefault
                        ? 'New threads start with this provider and model.'
                        : 'Choose a model to make this provider the default.'}
                    </CardDescription>
                  </div>
                  {isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void saveDefault(provider.id, null)}
                      disabled={pendingProviderId !== null}
                    >
                      Clear default
                    </Button>
                  ) : null}
                </CardHeader>

                <CardContent className="flex flex-col gap-2">
                  {state === undefined || state.status === 'loading' ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner size="sm" label={`Loading models for ${provider.label}`} />
                      Loading models...
                    </div>
                  ) : null}

                  {state?.status === 'error' ? <InlineAlert>{state.message}</InlineAlert> : null}

                  {state?.status === 'ready' && models.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No models reported by this provider.
                    </p>
                  ) : null}

                  {state?.status === 'ready' && options.length > 0 ? (
                    <Select
                      options={options}
                      value={currentModelId}
                      onValueChange={(value) => {
                        if (value) void saveDefault(provider.id, value);
                      }}
                      placeholder="Choose a default model"
                      disabled={pendingProviderId !== null}
                      aria-label={`Default model for ${provider.label}`}
                    />
                  ) : null}

                  {errorsByProvider[provider.id] ? (
                    <InlineAlert>{errorsByProvider[provider.id]}</InlineAlert>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
