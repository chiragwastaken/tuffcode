import type { BrainEntry, BrainSlice } from '@tuffcode/contracts';
import { Badge, Button, IconButton, Input, ScrollArea, Spinner, Textarea, cn } from '@tuffcode/ui';
import { Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { formatRelativeTime } from '../sidebar/sidebar-model';
import { BRAIN_KIND_LABEL, summarizeBrainSlice } from '../inspector/brain-model';
import { formatSearchScore } from './brain-search';
import type { BrainGraphNode } from './graph-layout';
import { BRAIN_KIND_COLOR } from './graph-style';

export interface BrainEntryPatch {
  text: string;
  tags: string;
  importance: number;
}

export interface BrainDetailsProps {
  entry: BrainEntry | null;
  node: BrainGraphNode | null;
  slice: BrainSlice | null;
  previewMessage: string;
  previewLoading: boolean;
  previewError: string | null;
  searchHit: { score: number; reason: string } | null;
  busy: boolean;
  actionError: string | null;
  onRefresh: () => void;
  onClose: () => void;
  onSave: (patch: BrainEntryPatch) => void;
  onToggle: () => void;
  onDelete: () => void;
}

type InjectionState = 'always' | 'retrieved' | 'none';

export function injectionState(slice: BrainSlice | null, id: string): InjectionState {
  if (slice === null) return 'none';
  if (slice.always.some((entry) => entry.id === id)) return 'always';
  if (slice.retrieved.some((entry) => entry.id === id)) return 'retrieved';
  return 'none';
}

function splitTags(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function injectionLabel(state: InjectionState): string {
  if (state === 'always') return 'Always injected';
  if (state === 'retrieved') return 'Retrieved';
  return 'Not in this preview';
}

/**
 * Right-hand details for the selected entry: the full text, tags, importance,
 * usage counters and whether the current preview would inject it. Edits round-trip
 * every field the upsert contract exposes so a save cannot drop scope or source.
 */
export function BrainDetails({
  entry,
  node,
  slice,
  previewMessage,
  previewLoading,
  previewError,
  searchHit,
  busy,
  actionError,
  onRefresh,
  onClose,
  onSave,
  onToggle,
  onDelete,
}: BrainDetailsProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(entry?.text ?? '');
  const [draftTags, setDraftTags] = useState(entry?.tags ?? '');
  const [draftImportance, setDraftImportance] = useState(String(entry?.importance ?? 0));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const entryId = entry?.id ?? null;
  const entryUpdatedAt = entry?.updatedAt ?? null;
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setDraftText(entry?.text ?? '');
    setDraftTags(entry?.tags ?? '');
    setDraftImportance(String(entry?.importance ?? 0));
    // Reset drafts when another entry opens or the saved row comes back updated.
  }, [entryId, entryUpdatedAt]);

  if (entry === null) {
    return (
      <aside
        data-testid="brain-details"
        aria-label="Brain entry details"
        className="flex w-60 shrink-0 flex-col border-l border-border bg-background @max-[480px]:absolute @max-[480px]:inset-y-0 @max-[480px]:right-0 @max-[480px]:z-10 @max-[480px]:w-full"
      >
        <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Details
          </span>
          <IconButton
            icon={X}
            label="Close details"
            size="sm"
            className="ml-auto"
            onClick={onClose}
          />
        </header>
        {node === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
            <p className="text-xs text-muted-foreground">Select a node or row</p>
            <p className="text-2xs leading-4 text-muted-foreground">
              Its text, tags, importance and injection history appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2 p-2.5">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: BRAIN_KIND_COLOR[node.kind] }}
              />
              <Badge variant="outline" size="sm">
                {BRAIN_KIND_LABEL[node.kind]}
              </Badge>
            </div>
            <p className="text-xs leading-5 break-words text-foreground">{node.label}</p>
            <p className="text-2xs leading-4 text-muted-foreground">
              importance {node.importance.toFixed(2)} · {node.degree}{' '}
              {node.degree === 1 ? 'relation' : 'relations'} · not in the loaded list
            </p>
            <p className="text-2xs leading-4 text-muted-foreground">
              The graph keeps project anchors that fall outside the entry list cap. Refresh to load
              the full entry.
            </p>
            <Button size="sm" variant="outline" onClick={onRefresh}>
              Refresh entries
            </Button>
          </div>
        )}
      </aside>
    );
  }

  const kindLabel = BRAIN_KIND_LABEL[entry.kind];
  const injection = injectionState(slice, entry.id);
  const tags = splitTags(entry.tags);
  const importance = Number(draftImportance);
  const importanceValid = Number.isFinite(importance) && importance >= 0 && importance <= 1;
  const canSave = draftText.trim().length > 0 && importanceValid && !busy;

  function handleSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSave) return;
    onSave({ text: draftText.trim(), tags: draftTags.trim(), importance });
  }

  function handleCancelEdit(): void {
    setEditing(false);
    setDraftText(entry?.text ?? '');
    setDraftTags(entry?.tags ?? '');
    setDraftImportance(String(entry?.importance ?? 0));
  }

  return (
    <aside
      data-testid="brain-details"
      aria-label="Brain entry details"
      className="flex w-60 shrink-0 flex-col border-l border-border bg-background @max-[480px]:absolute @max-[480px]:inset-y-0 @max-[480px]:right-0 @max-[480px]:z-10 @max-[480px]:w-full"
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: BRAIN_KIND_COLOR[entry.kind] }}
        />
        <Badge variant="outline" size="sm">
          {kindLabel}
        </Badge>
        <span
          className={cn(
            'text-2xs',
            entry.active ? 'text-success-foreground' : 'text-muted-foreground',
          )}
        >
          {entry.active ? 'Active' : 'Inactive'}
        </span>
        <IconButton
          icon={X}
          label="Close details"
          size="sm"
          className="ml-auto"
          onClick={onClose}
        />
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2.5">
          {editing ? (
            <form onSubmit={handleSave} className="flex flex-col gap-2">
              <Textarea
                autoFocus
                rows={4}
                className="min-h-0 text-xs"
                aria-label="Entry text"
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
              />
              <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                Tags
                <Input
                  className="h-7 text-xs"
                  aria-label="Entry tags"
                  placeholder="comma, separated"
                  value={draftTags}
                  onChange={(event) => setDraftTags(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                Importance
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className="h-7 text-xs"
                  aria-label="Entry importance"
                  value={draftImportance}
                  onChange={(event) => setDraftImportance(event.target.value)}
                />
              </label>
              <div className="flex items-center gap-1">
                <Button type="submit" size="sm" variant="primary" disabled={!canSave}>
                  {busy ? <Spinner size="sm" label="Saving entry" /> : null}
                  Save
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={handleCancelEdit}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-xs leading-5 break-words whitespace-pre-wrap text-foreground">
              {entry.text}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-2 text-2xs">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Importance</dt>
              <dd className="flex items-center gap-1.5 tabular-nums text-foreground">
                {entry.importance.toFixed(2)}
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${String(Math.round(entry.importance * 100))}%` }}
                  />
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Used</dt>
              <dd className="tabular-nums text-foreground">
                {entry.useCount} {entry.useCount === 1 ? 'time' : 'times'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Last used</dt>
              <dd className="text-foreground">
                {entry.lastUsedAt === null ? 'Never' : formatRelativeTime(entry.lastUsedAt)}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Scope</dt>
              <dd className="truncate text-foreground" title={entry.appliesTo ?? entry.scope}>
                {entry.scope}
                {entry.appliesTo === null ? '' : ` · ${entry.appliesTo}`}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-muted-foreground">Tags</span>
            {tags.length === 0 ? (
              <span className="text-2xs text-muted-foreground">No tags</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="neutral" size="sm">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <section aria-label="Injection history" className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-2xs font-medium text-muted-foreground">Injection</span>
              {previewLoading ? <Spinner size="sm" label="Loading preview" /> : null}
              <Badge
                variant={
                  injection === 'none' ? 'neutral' : injection === 'always' ? 'primary' : 'info'
                }
                size="sm"
                className="ml-auto"
              >
                {injectionLabel(injection)}
              </Badge>
            </div>
            {previewError === null ? null : (
              <p role="alert" className="text-2xs leading-4 text-error">
                {previewError}
              </p>
            )}
            {slice === null ? (
              <p className="text-2xs leading-4 text-muted-foreground">
                Open a project thread to preview the next injection.
              </p>
            ) : (
              <p className="text-2xs leading-4 text-muted-foreground">
                For {previewMessage.trim().length === 0 ? 'the whole turn' : `“${previewMessage}”`}:{' '}
                {summarizeBrainSlice(slice)}.
              </p>
            )}
            {node === null ? null : (
              <p className="text-2xs leading-4 text-muted-foreground">
                {node.degree} {node.degree === 1 ? 'relation' : 'relations'} in the graph.
              </p>
            )}
          </section>

          <section aria-label="Why this was injected" className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-muted-foreground">
              Why this was injected
            </span>
            {searchHit === null ? (
              <p className="text-2xs leading-4 text-muted-foreground">
                {injection === 'always'
                  ? `Active ${kindLabel.toLowerCase()} entries in ${entry.scope} scope are part of every turn.`
                  : injection === 'retrieved'
                    ? 'The selector matched this entry against the preview message and ranked it into the slice.'
                    : 'Not selected for the current preview message.'}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <Badge variant="primary" size="sm">
                    score {formatSearchScore(searchHit.score)}
                  </Badge>
                </span>
                <p className="text-2xs leading-4 text-muted-foreground">{searchHit.reason}</p>
              </div>
            )}
          </section>

          {actionError === null ? null : (
            <p role="alert" className="text-2xs leading-4 text-error">
              {actionError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || editing}
              onClick={() => setEditing(true)}
            >
              <Pencil strokeWidth={1.75} />
              Edit
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onToggle}>
              {entry.active ? 'Deactivate' : 'Activate'}
            </Button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="danger" disabled={busy} onClick={onDelete}>
                  {busy ? <Spinner size="sm" label="Deleting entry" /> : null}
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <IconButton
                icon={Trash2}
                label="Delete brain entry"
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              />
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
