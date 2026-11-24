import type { ApprovalChoice } from '@tuffcode/contracts';
import { Badge, Button, Spinner, cn } from '@tuffcode/ui';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { formatToolInput, type ApprovalItem } from './grouping';
import { setApprovalDecision } from './local-messages';

const DECISION_LABEL: Record<ApprovalChoice, string> = {
  allow: 'Allowed',
  'allow-thread': 'Allowed for thread',
  deny: 'Denied',
};

const DECISION_VARIANT: Record<ApprovalChoice, 'success' | 'info' | 'error'> = {
  allow: 'success',
  'allow-thread': 'info',
  deny: 'error',
};

const CHOICES: {
  choice: ApprovalChoice;
  label: string;
  variant: 'primary' | 'secondary' | 'outline';
}[] = [
  { choice: 'allow', label: 'Allow', variant: 'primary' },
  { choice: 'allow-thread', label: 'Allow for thread', variant: 'secondary' },
  { choice: 'deny', label: 'Deny', variant: 'outline' },
];

export interface ApprovalCardProps {
  item: ApprovalItem;
  threadId: string;
}

export function ApprovalCard({ item, threadId }: ApprovalCardProps) {
  const rpc = useRpc();
  const [pending, setPending] = useState<ApprovalChoice | null>(null);

  async function decide(choice: ApprovalChoice): Promise<void> {
    if (pending || item.decision) return;
    setPending(choice);
    try {
      await rpc.request('threads.approve', {
        threadId,
        approvalId: item.approvalId,
        decision: choice,
      });
      setApprovalDecision(item.approvalId, choice);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the approval decision.');
    } finally {
      setPending(null);
    }
  }

  const input = formatToolInput(item.input);

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        item.decision === 'deny'
          ? 'border-error/40 bg-error-surface'
          : 'border-warning/40 bg-warning-surface',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'size-4',
            item.decision === 'deny' ? 'text-error-foreground' : 'text-warning-foreground',
          )}
        />
        <span className="text-xs font-medium text-foreground">Approval needed</span>
        <span className="truncate font-mono text-2xs text-muted-foreground">{item.name}</span>
        {item.decision ? (
          <Badge variant={DECISION_VARIANT[item.decision]} className="ml-auto">
            {DECISION_LABEL[item.decision]}
          </Badge>
        ) : null}
      </div>

      {input ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-2xs leading-5 whitespace-pre-wrap text-muted-foreground">
          {input}
        </pre>
      ) : null}

      {item.decision ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {CHOICES.map(({ choice, label, variant }) => (
            <Button
              key={choice}
              size="sm"
              variant={variant}
              disabled={pending !== null}
              onClick={() => void decide(choice)}
            >
              {pending === choice ? <Spinner size="sm" label="Sending" /> : null}
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
