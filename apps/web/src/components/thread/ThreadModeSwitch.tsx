import { Users, Wrench } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

type ThreadMode = 'work' | 'council';

const THREAD_MODES: readonly SegmentedOption<ThreadMode>[] = [
  { value: 'work', label: 'Work', icon: Wrench },
  { value: 'council', label: 'Council', icon: Users },
];

export interface ThreadModeSwitchProps {
  threadId: string | null;
  className?: string;
}

/**
 * The Work/Council switch that lives in the app topbar. It reads the thread from the
 * store so it follows `thread.updated` broadcasts, and persists a change through
 * `threads.update`. It renders nothing when no thread is open.
 */
export function ThreadModeSwitch({ threadId, className }: ThreadModeSwitchProps) {
  const rpc = useRpc();
  const thread = useAppStore((state) => (threadId === null ? undefined : state.threads[threadId]));
  const upsertThread = useAppStore((state) => state.upsertThread);
  const [switching, setSwitching] = useState(false);

  if (thread === undefined) return null;

  const id = thread.id;
  const mode: ThreadMode = thread.executionMode === 'council' ? 'council' : 'work';

  async function setMode(next: ThreadMode): Promise<void> {
    if (next === mode) return;
    setSwitching(true);
    try {
      upsertThread(await rpc.request('threads.update', { id, executionMode: next }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch the thread mode.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <SegmentedControl
      ariaLabel="Thread mode"
      testId="thread-mode-switch"
      size="md"
      className={className}
      value={mode}
      options={THREAD_MODES}
      disabled={switching}
      onValueChange={(next) => void setMode(next)}
    />
  );
}
