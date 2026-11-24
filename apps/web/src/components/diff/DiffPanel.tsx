import type {
  Checkpoint,
  DiffFile,
  ReviewComment,
  ReviewCommentSide,
} from '@tuffcode/contracts';
import {
  Button,
  DiffViewer,
  EmptyState,
  IconButton,
  ScrollArea,
  Select,
  Spinner,
  Textarea,
  cn,
  type DiffLineComment,
} from '@tuffcode/ui';
import { FileDiff, MessageSquarePlus, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRpc } from '../../rpc/rpc-context';
import { CommentList } from './CommentList';
import { FileTree } from './FileTree';
import {
  DIFF_STATUS_META,
  WORKING_TREE_CHECKPOINT,
  buildDiffTree,
  checkpointIdFromValue,
  checkpointValue,
  diffRequestKey,
  fileLineForRenderedLine,
  shouldApplyDiffResponse,
  splitPatchSides,
  summarizeDiff,
  validateCommentDraft,
} from './diff-model';

export interface DiffPanelProps {
  threadId: string;
}

interface CommentAnchor {
  path: string;
  line: number;
  side: ReviewCommentSide;
}

/**
 * Review panel for one thread: changed files grouped by directory, the selected
 * file through the design system diff viewer, inline comments, and a checkpoint
 * selector that rebases the diff.
 */
export function DiffPanel({ threadId }: DiffPanelProps) {
  return <DiffPanelBody key={threadId} threadId={threadId} />;
}

function DiffPanelBody({ threadId }: DiffPanelProps) {
  const rpc = useRpc();

  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [draft, setDraft] = useState<CommentAnchor | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);

  const activeKeyRef = useRef('');

  useEffect(() => {
    const key = diffRequestKey(threadId, checkpointId);
    activeKeyRef.current = key;
    let cancelled = false;
    setLoading(true);
    setError(null);

    rpc
      .request('diff.get', checkpointId === null ? { threadId } : { threadId, checkpointId })
      .then((result) => {
        if (cancelled || !shouldApplyDiffResponse(activeKeyRef.current, key)) return;
        setFiles(result.files);
      })
      .catch((caught: unknown) => {
        if (cancelled || !shouldApplyDiffResponse(activeKeyRef.current, key)) return;
        setFiles([]);
        setError(caught instanceof Error ? caught.message : 'Could not load the diff.');
      })
      .finally(() => {
        if (cancelled || !shouldApplyDiffResponse(activeKeyRef.current, key)) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, checkpointId, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setCheckpointError(null);

    rpc
      .request('checkpoints.list', { threadId })
      .then((result) => {
        if (!cancelled) setCheckpoints(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setCheckpoints([]);
        setCheckpointError(
          caught instanceof Error ? caught.message : 'Could not load the checkpoints.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setCommentsError(null);

    rpc
      .request('comments.list', { threadId })
      .then((result) => {
        if (!cancelled) setComments(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setComments([]);
        setCommentsError(
          caught instanceof Error ? caught.message : 'Could not load the comments.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, reloadToken]);

  const directories = buildDiffTree(files);
  const summary = summarizeDiff(files);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const sides = selectedFile ? splitPatchSides(selectedFile.patch) : null;
  const selectedMeta = selectedFile ? DIFF_STATUS_META[selectedFile.status] : null;

  function reload(): void {
    setReloadToken((token) => token + 1);
  }

  function handleCheckpointChange(value: string | null): void {
    setCheckpointId(checkpointIdFromValue(value));
    setFiles([]);
    setSelectedPath(null);
    setDraft(null);
    setError(null);
  }

  function handleLineComment(comment: DiffLineComment): void {
    setDraft({
      path: comment.path,
      line: fileLineForRenderedLine(sides, comment.side, comment.line),
      side: comment.side,
    });
    setDraftBody('');
    setDraftError(null);
  }

  async function handleAddComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;

    const errors = validateCommentDraft(draftBody);
    if (errors.body) {
      setDraftError(errors.body);
      return;
    }

    setSavingComment(true);
    setDraftError(null);
    try {
      const created = await rpc.request('comments.add', {
        threadId,
        filePath: draft.path,
        line: draft.line,
        side: draft.side,
        body: draftBody.trim(),
      });
      setComments((previous) => [...previous, created]);
      setDraft(null);
      setDraftBody('');
    } catch (caught) {
      setDraftError(caught instanceof Error ? caught.message : 'Could not add the comment.');
    } finally {
      setSavingComment(false);
    }
  }

  async function handleResolve(comment: ReviewComment): Promise<void> {
    setResolvingId(comment.id);
    setCommentsError(null);
    try {
      const updated = await rpc.request('comments.resolve', {
        id: comment.id,
        resolved: !comment.resolved,
      });
      setComments((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setCommentsError(caught instanceof Error ? caught.message : 'Could not resolve the comment.');
    } finally {
      setResolvingId(null);
    }
  }

  const checkpointOptions = [
    { value: WORKING_TREE_CHECKPOINT, label: 'Working tree' },
    ...checkpoints.map((checkpoint) => ({ value: checkpoint.id, label: checkpoint.label })),
  ];

  return (
    <section aria-label="Diff" className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-[var(--row-height)] shrink-0 items-center gap-2 border-b border-border px-3">
        <FileDiff aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Changes</span>
        {files.length > 0 ? (
          <span className="text-2xs tabular-nums text-muted-foreground">
            {summary.fileCount} {summary.fileCount === 1 ? 'file' : 'files'}
          </span>
        ) : null}
        {loading ? <Spinner size="sm" label="Loading diff" /> : null}
        <IconButton
          icon={RefreshCw}
          label="Refresh diff"
          size="sm"
          className="ml-auto"
          disabled={loading}
          onClick={reload}
        />
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-2xs text-muted-foreground">Base</span>
        <div className="w-48">
          <Select
            aria-label="Diff base"
            className="h-8 text-xs"
            options={checkpointOptions}
            value={checkpointValue(checkpointId)}
            onValueChange={handleCheckpointChange}
          />
        </div>
        {files.length > 0 ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-2xs tabular-nums">
            <span className="text-success-foreground">+{summary.additions}</span>
            <span className="text-error-foreground">-{summary.deletions}</span>
          </span>
        ) : null}
      </div>

      {checkpointError ? (
        <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-2xs text-error">
          {checkpointError}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form
          onSubmit={handleAddComment}
          className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface-raised px-3 py-2"
        >
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="truncate font-mono" title={draft.path}>
              {draft.path}
            </span>
            <span className="shrink-0 tabular-nums">:{draft.line}</span>
            <span className="shrink-0">{draft.side === 'old' ? 'old line' : 'new line'}</span>
            <IconButton
              icon={X}
              label="Cancel comment"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setDraft(null);
                setDraftError(null);
              }}
            />
          </div>
          <Textarea
            id="diff-comment-body"
            rows={2}
            autoFocus
            value={draftBody}
            onChange={(event) => {
              setDraftBody(event.target.value);
              setDraftError(null);
            }}
            aria-invalid={Boolean(draftError)}
            aria-describedby={draftError ? 'diff-comment-body-error' : undefined}
            placeholder="Leave a review comment"
            className="min-h-16"
          />
          {draftError ? (
            <p id="diff-comment-body-error" role="alert" className="text-2xs text-error">
              {draftError}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={savingComment}
              onClick={() => {
                setDraft(null);
                setDraftError(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={savingComment}>
              {savingComment ? 'Adding' : 'Add comment'}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {directories.length > 0 ? (
          <FileTree
            directories={directories}
            selectedPath={selectedFile?.path ?? null}
            onSelect={setSelectedPath}
          />
        ) : null}

        <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="pb-3">
          {selectedFile ? (
            <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border bg-background px-3">
              <span className="truncate font-mono text-xs text-foreground" title={selectedFile.path}>
                {selectedFile.path}
              </span>
              {selectedFile.oldPath ? (
                <span
                  className="shrink-0 truncate font-mono text-2xs text-muted-foreground"
                  title={selectedFile.oldPath}
                >
                  from {selectedFile.oldPath}
                </span>
              ) : null}
              {selectedMeta ? (
                <span className={cn('shrink-0 text-2xs', selectedMeta.className)}>
                  {selectedMeta.label}
                </span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-2xs tabular-nums">
                <span className="text-success-foreground">+{selectedFile.additions}</span>
                <span className="text-error-foreground">-{selectedFile.deletions}</span>
              </span>
            </div>
          ) : null}

          <div className="p-3">
            {selectedFile && sides ? (
              <DiffViewer
                files={[
                  {
                    path: selectedFile.path,
                    oldText: sides.oldText,
                    newText: sides.newText,
                  },
                ]}
                onLineComment={handleLineComment}
              />
            ) : selectedFile ? (
              <EmptyState
                title="No preview"
                description={
                  selectedFile.binary
                    ? 'This file is binary, so there is no text diff to render.'
                    : 'This patch is too large to render. Open the file in the editor instead.'
                }
              />
            ) : (
              <EmptyState
                icon={FileDiff}
                title="No changes"
                description={
                  checkpointId === null
                    ? 'The worktree matches HEAD. Edits made by the agent will show up here.'
                    : 'Nothing changed between this checkpoint and the worktree.'
                }
                action={
                  <Button size="sm" variant="secondary" disabled={loading} onClick={reload}>
                    Refresh
                  </Button>
                }
              />
            )}
          </div>
        </ScrollArea>
      </div>

      <section
        aria-label="Review comments"
        className="flex max-h-64 shrink-0 flex-col border-t border-border"
      >
        <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-2xs text-muted-foreground">
          <MessageSquarePlus aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          <span>
            {comments.length === 1 ? '1 comment' : `${comments.length} comments`}
          </span>
          {commentsError ? (
            <span role="alert" className="ml-auto truncate text-error" title={commentsError}>
              {commentsError}
            </span>
          ) : null}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <CommentList
            comments={comments}
            busyId={resolvingId}
            onResolve={(comment) => {
              void handleResolve(comment);
            }}
            onSelectFile={setSelectedPath}
          />
        </ScrollArea>
      </section>
    </section>
  );
}
