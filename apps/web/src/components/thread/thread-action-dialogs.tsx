import { useNavigate } from '@tanstack/react-router';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Input,
  Spinner,
} from '@tuffcode/ui';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { runAction } from '../actions';
import { useActionPorts } from '../menu/action-context';
import { ConfirmDialog } from '../settings/confirm-dialog';
import { InlineAlert } from '../settings/inline-alert';
import { closeThreadDialog, useThreadDialogRequest } from './thread-dialogs';

/**
 * Rename and delete confirmation for any thread action surface. Mounted once in
 * the shell so the sidebar menu, the palette and future shortcuts share it.
 */
export function ThreadActionDialogs() {
  const request = useThreadDialogRequest();
  const ports = useActionPorts();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setBusy(false);
    if (request?.kind === 'rename') setTitle(request.thread.title);
  }, [request]);

  async function rename(): Promise<void> {
    if (request?.kind !== 'rename') return;
    const next = title.trim();
    if (next === '') {
      setError('A thread needs a title.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await runAction('thread.rename', {
        ...ports,
        thread: request.thread,
        input: { title: next },
      });
      closeThreadDialog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename the thread.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (request?.kind !== 'delete') return;
    const thread = request.thread;
    const wasActive = useAppStore.getState().activeThreadId === thread.id;

    setBusy(true);
    setError(null);
    try {
      await runAction('thread.delete', { ...ports, thread, input: { confirmed: true } });
      closeThreadDialog();
      if (wasActive) void navigate({ to: '/' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the thread.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogRoot
        open={request?.kind === 'rename'}
        onOpenChange={(open) => {
          if (!open && !busy) closeThreadDialog();
        }}
      >
        <DialogContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <div>
              <DialogTitle>Rename thread</DialogTitle>
              <DialogDescription>
                The new title shows in the sidebar and the thread header.
              </DialogDescription>
            </div>
            <Input
              value={title}
              autoFocus
              aria-label="Thread title"
              onChange={(event) => {
                setTitle(event.target.value);
                setError(null);
              }}
              disabled={busy}
            />
            {error ? <InlineAlert>{error}</InlineAlert> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={closeThreadDialog}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? <Spinner size="sm" /> : null}
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>

      <ConfirmDialog
        open={request?.kind === 'delete'}
        onOpenChange={(open) => {
          if (!open && !busy) closeThreadDialog();
        }}
        title={`Delete ${request?.kind === 'delete' ? request.thread.title || 'this thread' : 'this thread'}?`}
        description="The thread and its messages leave Tuffcode. Files and the worktree on disk stay where they are."
        confirmLabel="Delete thread"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
      />
    </>
  );
}
