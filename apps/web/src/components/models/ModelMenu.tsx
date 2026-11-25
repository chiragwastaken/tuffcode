import type { Model, ProviderView, SubagentModels, Thread } from '@tuffcode/contracts';
import { IconButton, Input, PopoverContent, PopoverRoot, PopoverTrigger, Select, Spinner, cn } from '@tuffcode/ui';
import { Check, ChevronDown, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { SUBAGENT_DESCRIPTION, SUBAGENT_LABEL, SUBAGENT_TYPES, type SubagentTypeName } from '../settings/custom-prompt';
import { modelDisplayLabel, providerDotClass, withCurrentModel } from './model-picker';
import { effortChoices, effortText, filterMenuModels, menuProviders, providerEffortsOf } from './model-menu';
import { useProviderModels } from './use-provider-models';

export interface ModelMenuProps {
  thread: Thread | undefined;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Moves the thread: provider, model and reasoning level in one update. */
  onApply: (patch: { providerId?: string; modelId?: string; reasoningEffort?: string | null }) => void;
}

type Tab = 'model' | 'subagents';

/**
 * The composer's square model menu: every enabled provider on the left, its models
 * on the right with search, the reasoning level along the bottom, and a Subagents tab
 * that sets the model each subagent type runs on.
 */
export function ModelMenu({ thread, disabled = false, open, onOpenChange, onApply }: ModelMenuProps) {
  const providers = useAppStore((state) => state.providers);
  const list = useMemo(() => menuProviders(providers, thread?.providerId), [providers, thread?.providerId]);
  const current = providers.find((provider) => provider.id === thread?.providerId);
  const [selectedId, setSelectedId] = useState<string | undefined>(thread?.providerId);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('model');

  useEffect(() => {
    if (open) {
      setSelectedId(thread?.providerId);
      setQuery('');
    }
  }, [open, thread?.providerId]);

  const selected = providers.find((provider) => provider.id === selectedId) ?? current;
  const models = useProviderModels(selected?.id);
  const rows = useMemo(() => {
    const base =
      selected !== undefined && selected.id === thread?.providerId
        ? withCurrentModel(models.models, selected.id, thread?.modelId ?? null)
        : models.models;
    return filterMenuModels(base, query);
  }, [models.models, query, selected, thread?.modelId, thread?.providerId]);
  const currentModel = models.models.find((model) => model.modelId === thread?.modelId && selected?.id === thread?.providerId);
  const efforts = effortChoices(currentModel, providerEffortsOf(current));

  function pick(model: Model): void {
    if (selected === undefined || thread === undefined) return;
    if (selected.id !== thread.providerId) onApply({ providerId: selected.id, modelId: model.modelId });
    else if (model.modelId !== thread.modelId) onApply({ modelId: model.modelId });
    onOpenChange(false);
  }

  const triggerLabel = thread?.modelId ?? 'Choose a model';

  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={disabled || thread === undefined}
        data-testid="model-menu-trigger"
        aria-label={`Model: ${triggerLabel}`}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', providerDotClass(current?.kind))} />
        <span className="min-w-0 truncate text-foreground">{triggerLabel}</span>
        {thread?.reasoningEffort ? <span className="shrink-0">{effortText(thread.reasoningEffort)}</span> : null}
        <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex h-[26rem] w-[min(34rem,92vw)] flex-col p-0" data-testid="model-menu">
        <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5" role="tablist">
          {(['model', 'subagents'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              data-testid={`model-menu-tab-${entry}`}
              onClick={() => setTab(entry)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs',
                tab === entry ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry === 'model' ? 'Model' : 'Subagents'}
            </button>
          ))}
        </div>

        {tab === 'model' ? (
          <>
            <div className="flex min-h-0 flex-1">
              <div className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-1.5" aria-label="Providers">
                {list.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    data-testid="model-menu-provider"
                    aria-pressed={provider.id === selected?.id}
                    onClick={() => setSelectedId(provider.id)}
                    className={cn(
                      'flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs',
                      provider.id === selected?.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', providerDotClass(provider.kind))} />
                    <span className="truncate">{provider.label}</span>
                  </button>
                ))}
                {list.length === 0 ? <p className="px-2 py-2 text-2xs text-muted-foreground">No enabled providers.</p> : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
                  <Search aria-hidden="true" className="ml-1 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${selected?.label ?? ''} models`}
                    aria-label="Search models"
                    data-testid="model-menu-search"
                    className="h-7 flex-1 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
                  />
                  <IconButton icon={RefreshCw} label="Fetch models" size="sm" disabled={models.refreshing} onClick={models.refresh} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Models">
                  {models.status === 'loading' && rows.length === 0 ? (
                    <div className="flex justify-center py-6">
                      <Spinner size="sm" label="Loading models" />
                    </div>
                  ) : null}
                  {rows.map((model) => {
                    const active = selected?.id === thread?.providerId && model.modelId === thread?.modelId;
                    return (
                      <button
                        key={model.modelId}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-testid="model-menu-model"
                        onClick={() => pick(model)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-xs text-foreground">{modelDisplayLabel(model)}</span>
                          {model.label !== model.modelId ? (
                            <span className="truncate font-mono text-2xs text-muted-foreground">{model.modelId}</span>
                          ) : null}
                        </span>
                        {model.contextWindow ? (
                          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                            {Math.round(model.contextWindow / 1000)}k
                          </span>
                        ) : null}
                        {active ? <Check className="size-3.5 shrink-0 text-primary" strokeWidth={2} /> : null}
                      </button>
                    );
                  })}
                  {models.status !== 'loading' && rows.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      {models.error ?? 'No models. Press fetch to ask the provider.'}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-2.5 py-2" data-testid="model-menu-effort">
              <span className="mr-1 text-2xs text-muted-foreground">Reasoning</span>
              {[null, ...efforts].map((level) => {
                const on = (thread?.reasoningEffort ?? null) === level;
                return (
                  <button
                    key={level ?? 'auto'}
                    type="button"
                    aria-pressed={on}
                    data-testid={`model-menu-effort-${level ?? 'auto'}`}
                    onClick={() => onApply({ reasoningEffort: level })}
                    className={cn(
                      'h-6 rounded-full border px-2.5 text-2xs',
                      on ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {effortText(level)}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <SubagentModelsTab providers={list} />
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

function SubagentModelsTab({ providers }: { providers: ProviderView[] }) {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const rpc = useRpc();
  if (settings === null) return null;
  const choices = settings.subagentModels;

  async function save(next: SubagentModels): Promise<void> {
    try {
      setSettings(await rpc.request('settings.set', { patch: { subagentModels: next } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save subagent models.');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" data-testid="model-menu-subagents">
      <p className="px-1 pb-1 text-2xs text-muted-foreground">
        Each subagent type runs on its own model. Empty uses the parent chat&apos;s model.
      </p>
      {SUBAGENT_TYPES.map((type) => (
        <SubagentRow
          key={type}
          type={type}
          providers={providers}
          providerId={choices[type].providerId}
          model={choices[type].model}
          onChange={(providerId, model) =>
            void save({
              ...choices,
              [type]: {
                ...choices[type],
                ...(providerId === undefined ? { providerId: undefined } : { providerId }),
                ...(model === undefined ? { model: undefined } : { model }),
              },
            })
          }
        />
      ))}
    </div>
  );
}

const PARENT = '__parent__';

function SubagentRow({
  type,
  providers,
  providerId,
  model,
  onChange,
}: {
  type: SubagentTypeName;
  providers: ProviderView[];
  providerId: string | undefined;
  model: string | undefined;
  onChange: (providerId: string | undefined, model: string | undefined) => void;
}) {
  const models = useProviderModels(providerId);
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-md px-1 py-1" data-testid={`subagent-model-${type}`}>
      <span className="flex flex-col">
        <span className="text-xs text-foreground">{SUBAGENT_LABEL[type]}</span>
        <span className="truncate text-2xs text-muted-foreground" title={SUBAGENT_DESCRIPTION[type]}>
          {SUBAGENT_DESCRIPTION[type]}
        </span>
      </span>
      <Select
        aria-label={`${SUBAGENT_LABEL[type]} provider`}
        value={providerId ?? PARENT}
        options={[{ value: PARENT, label: 'Parent chat' }, ...providers.map((provider) => ({ value: provider.id, label: provider.label }))]}
        onValueChange={(value) => onChange(value === null || value === PARENT ? undefined : value, undefined)}
      />
      <Select
        aria-label={`${SUBAGENT_LABEL[type]} model`}
        disabled={providerId === undefined}
        value={model ?? PARENT}
        options={[
          { value: PARENT, label: providerId === undefined ? 'Parent model' : 'Provider default' },
          ...models.models.map((entry) => ({ value: entry.modelId, label: modelDisplayLabel(entry) })),
        ]}
        onValueChange={(value) => onChange(providerId, value === null || value === PARENT ? undefined : value)}
      />
    </div>
  );
}
