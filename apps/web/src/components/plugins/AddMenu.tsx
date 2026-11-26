import type { McpAuthMode } from '@tuffcode/contracts';
import { useNavigate } from '@tanstack/react-router';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Input,
  PopoverClose,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  buttonVariants,
  cn,
} from '@tuffcode/ui';
import { ChevronDown, Link2, Sparkles, Store, Upload, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useRpc } from '../../rpc/rpc-context';
import { useAppStore } from '../../store/app-store';
import { setPendingDraft } from '../thread/composer-drafts';
import { FormField } from '../settings/form-field';
import { createSkillPrompt } from './plugins-model';

export interface AddMenuProps {
  onUpload: (path: string) => Promise<void>;
  onAddMarketplace: (url: string) => Promise<boolean>;
}

/**
 * The hub's Add menu: install a local .zip, .skill or SKILL.md; add a remote MCP
 * connector by URL; start a chat that writes a new skill; or add a marketplace repo.
 */
export function AddMenu({ onUpload, onAddMarketplace }: AddMenuProps) {
  const rpc = useRpc();
  const navigate = useNavigate();
  const settings = useAppStore((state) => state.settings);
  const projects = useAppStore((state) => state.projects);
  const activeThreadId = useAppStore((state) => state.activeThreadId);
  const threads = useAppStore((state) => state.threads);
  const upsertThread = useAppStore((state) => state.upsertThread);
  const [dialog, setDialog] = useState<'connector' | 'marketplace' | null>(null);
  const canPick = window.tuffcode?.pickFile !== undefined;

  async function upload(): Promise<void> {
    const path = await window.tuffcode?.pickFile?.({ title: 'Upload plugin', extensions: ['zip', 'skill', 'md'] });
    if (path) await onUpload(path);
  }

  async function createWithAi(): Promise<void> {
    const projectId =
      (activeThreadId === null ? undefined : threads[activeThreadId]?.projectId) ?? projects[0]?.id;
    if (projectId === undefined || !settings?.defaultProviderId || !settings.defaultModelId) {
      toast.error('Add a project and set a default model first.');
      return;
    }
    try {
      const thread = await rpc.request('threads.create', {
        projectId,
        providerId: settings.defaultProviderId,
        modelId: settings.defaultModelId,
        executionMode: 'work',
        permissionMode: settings.defaultPermissionMode,
      });
      upsertThread(thread);
      setPendingDraft(thread.id, createSkillPrompt());
      await navigate({ to: '/project/$projectId/thread/$threadId', params: { projectId, threadId: thread.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the chat.');
    }
  }

  return (
    <>
      <PopoverRoot>
        <PopoverTrigger data-testid="plugins-add" className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'gap-1')}>
          Add
          <ChevronDown className="size-3.5" strokeWidth={2} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-1">
          <Item icon={Upload} label="Upload plugin" detail=".zip, .skill or SKILL.md" testId="plugins-add-upload" disabled={!canPick} onClick={() => void upload()} />
          <Item icon={Link2} label="Add custom connector" detail="MCP server URL" testId="plugins-add-connector" onClick={() => setDialog('connector')} />
          <Item icon={Sparkles} label="Create with AI" detail="Write a new skill in a chat" testId="plugins-add-ai" onClick={() => void createWithAi()} />
          <Item icon={Store} label="Add marketplace" detail="GitHub owner/repo" testId="plugins-add-marketplace" onClick={() => setDialog('marketplace')} />
        </PopoverContent>
      </PopoverRoot>
      <CustomConnectorDialog open={dialog === 'connector'} onClose={() => setDialog(null)} />
      <MarketplaceDialog open={dialog === 'marketplace'} onClose={() => setDialog(null)} onAdd={onAddMarketplace} />
    </>
  );
}

function Item({
  icon: Icon,
  label,
  detail,
  testId,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <PopoverClose
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="flex flex-col">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-2xs text-muted-foreground">{detail}</span>
      </span>
    </PopoverClose>
  );
}

function CustomConnectorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rpc = useRpc();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authMode, setAuthMode] = useState<McpAuthMode>('bearer');
  const [header, setHeader] = useState('Authorization');
  const [prefix, setPrefix] = useState('Bearer ');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const urlValid =
    /^https:\/\/\S+$/.test(url.trim()) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url.trim());
  const canSubmit =
    name.trim().length > 0 &&
    urlValid &&
    (authMode !== 'bearer' || token.trim().length > 0) &&
    (authMode !== 'bearer' || /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(header.trim()));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const saved = await rpc.request('mcp.upsert', {
        label: name.trim(),
        transport: 'http',
        url: url.trim(),
        authMode,
        ...(authMode === 'bearer'
          ? { authHeader: header.trim(), secret: token.trim(), secretPrefix: prefix }
          : {}),
      });
      if (authMode === 'oauth') {
        const flow = await rpc.request('mcp.oauth.start', { id: saved.id });
        const openExternal = window.tuffcode?.openExternal;
        if (openExternal === undefined) {
          toast.success(`${name.trim()} added. Open ${flow.authorizeUrl} to sign in.`);
        } else {
          openExternal(flow.authorizeUrl);
          toast.success(`${name.trim()} added. Finish signing in in your browser.`);
        }
      } else {
        toast.success(`${name.trim()} added. Its tools are available on the next turn.`);
      }
      setName('');
      setUrl('');
      setToken('');
      setAuthMode('bearer');
      setHeader('Authorization');
      setPrefix('Bearer ');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the connector.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="w-[min(32rem,92vw)]" data-testid="custom-connector-dialog">
        <DialogTitle>Add custom connector</DialogTitle>
        <DialogDescription>Connect Tuffcode to your data and tools through a remote MCP server.</DialogDescription>
        <form className="mt-3 flex max-h-[70vh] flex-col gap-3 overflow-y-auto" onSubmit={(event) => void submit(event)}>
          <FormField label="Name" htmlFor="connector-name" hint="Shown in the connectors list.">
            <Input id="connector-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </FormField>
          <FormField
            label="MCP server URL"
            htmlFor="connector-url"
            hint="The HTTPS address where the server accepts MCP requests, for example https://mcp.example.com/mcp."
          >
            <Input id="connector-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
          </FormField>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium text-foreground">Authentication</legend>
            <div className="flex flex-wrap gap-3">
              {([
                ['none', 'None'],
                ['bearer', 'Bearer token / API key'],
                ['oauth', 'Browser OAuth'],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="connector-auth"
                    className="size-4 accent-primary"
                    value={value}
                    checked={authMode === value}
                    data-testid={`connector-auth-${value}`}
                    onChange={() => setAuthMode(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {authMode === 'bearer' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Header name" htmlFor="connector-header" hint="Defaults to Authorization.">
                <Input
                  id="connector-header"
                  value={header}
                  onChange={(event) => setHeader(event.target.value)}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </FormField>
              <FormField label="Value prefix" htmlFor="connector-prefix" hint="Bearer followed by a space is the usual.">
                <Input
                  id="connector-prefix"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </FormField>
              <div className="sm:col-span-2">
                <FormField
                  label="Token or API key"
                  htmlFor="connector-token"
                  hint="Stored with your OS keychain, never in the database or logs."
                >
                  <Input
                    id="connector-token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                  />
                </FormField>
              </div>
            </div>
          ) : null}
          {authMode === 'oauth' ? (
            <p className="text-2xs text-muted-foreground">
              Tuffcode registers with the server, opens your system browser to sign in, and stores
              the token it returns in your OS keychain. Finish the sign-in in the browser tab.
            </p>
          ) : null}
          <p className="text-2xs text-muted-foreground">
            Only add connectors from developers you trust. Tuffcode cannot verify what a server&apos;s tools do.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !canSubmit} data-testid="custom-connector-continue">
              {authMode === 'oauth' ? 'Add and sign in' : 'Continue'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

function MarketplaceDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (url: string) => Promise<boolean>;
}) {
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (url.trim().length < 3) return;
    setSaving(true);
    const added = await onAdd(url.trim());
    setSaving(false);
    if (added) {
      setUrl('');
      onClose();
    }
  }
  return (
    <DialogRoot open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="w-[min(28rem,92vw)]" data-testid="marketplace-dialog">
        <DialogTitle>Add marketplace</DialogTitle>
        <DialogDescription>
          A GitHub repository with a .claude-plugin/marketplace.json file, or an https link to that file.
        </DialogDescription>
        <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="owner/repo" autoFocus spellCheck={false} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || url.trim().length < 3}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
