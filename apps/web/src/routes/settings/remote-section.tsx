import type { PairCreateResult, RemoteSessionView } from '@tuffcode/contracts';
import { Button, Input } from '@tuffcode/ui';
import { useEffect, useState } from 'react';
import { SettingsRow } from '../../components/settings/settings-row';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';
import { useAppStore } from '../../store/app-store';

const KEYS = ['remote'] as const;

interface SessionList {
  sessions: RemoteSessionView[];
}

/**
 * Remote access is a desktop-owned setting: the file bearer token stays in the
 * preload bridge, and a browser only ever receives a paired session cookie.
 */
export function RemoteSection() {
  const controller = useSettingsDraft(KEYS);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const [pairing, setPairing] = useState<PairCreateResult | null>(null);
  const [sessions, setSessions] = useState<RemoteSessionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const remote = controller.draft?.remote;
  const token = bootstrap?.token;

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (bootstrap === null) throw new Error('The server is not ready.');
    const response = await fetch(`http://127.0.0.1:${bootstrap.port}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token ?? ''}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  async function loadSessions(): Promise<void> {
    if (token === undefined) return;
    try {
      const result = await api<SessionList>('/remote/sessions');
      setSessions(result.sessions);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not list devices.');
    }
  }

  useEffect(() => {
    void loadSessions();
    // The token is stable for this window; reloading sessions on every render would loop.
  }, [token]); // oxlint-disable-line react-hooks/exhaustive-deps

  async function createPairing(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      setPairing(await api<PairCreateResult>('/pair/create', { method: 'POST' }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create a pairing code.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await api('/remote/sessions/revoke', { method: 'POST', body: JSON.stringify({ id }) });
      await loadSessions();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not revoke that device.');
    } finally {
      setBusy(false);
    }
  }

  if (remote === undefined) return null;

  return (
    <form
      className="flex min-h-full flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.submit();
      }}
    >
      <SettingsSectionHeader
        title="Remote access"
        description="Serve the same Tuffcode workspace to a phone or another browser. Pairing is a one-time code; every device gets its own revocable session."
      />

      <div className="divide-y divide-border rounded-lg border border-border">
        <SettingsRow
          label="Enable remote access"
          description="Off keeps the server on loopback. Restart Tuffcode after changing this, the host or the port."
        >
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={remote.enabled}
              onChange={(event) =>
                controller.update({ remote: { ...remote, enabled: event.target.checked } })
              }
            />
            Allow phones and other browsers on the configured address
          </label>
        </SettingsRow>
        <SettingsRow
          label="Bind address"
          description="127.0.0.1 is local only. 0.0.0.0 listens on every interface; use a trusted LAN or Tailscale."
          htmlFor="remote-bind-host"
        >
          <Input
            id="remote-bind-host"
            value={remote.bindHost}
            onChange={(event) =>
              controller.update({ remote: { ...remote, bindHost: event.target.value } })
            }
            placeholder="127.0.0.1"
          />
        </SettingsRow>
        <SettingsRow
          label="Port"
          description="The port a phone opens. 4310 is the default."
          htmlFor="remote-port"
        >
          <Input
            id="remote-port"
            type="number"
            min={1}
            max={65535}
            value={remote.port}
            onChange={(event) =>
              controller.update({ remote: { ...remote, port: Number(event.target.value) } })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Address phones use"
          description="Optional. A LAN address or a Tailscale HTTPS URL, so the pairing link is usable from another device."
          htmlFor="remote-public-url"
        >
          <Input
            id="remote-public-url"
            value={remote.publicUrl}
            onChange={(event) =>
              controller.update({ remote: { ...remote, publicUrl: event.target.value } })
            }
            placeholder="https://my-machine.tailnet.ts.net"
          />
        </SettingsRow>
        <SettingsRow
          label="Extra allowed origins"
          description="Comma separated browser origins, only needed when a proxy changes the origin."
          htmlFor="remote-origins"
        >
          <Input
            id="remote-origins"
            value={remote.allowedOrigins.join(', ')}
            onChange={(event) =>
              controller.update({
                remote: {
                  ...remote,
                  allowedOrigins: event.target.value
                    .split(',')
                    .map((origin) => origin.trim())
                    .filter((origin) => origin.length > 0),
                },
              })
            }
            placeholder="http://192.168.1.20:4310"
          />
        </SettingsRow>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Pair a device</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              The code expires in five minutes and works once. The phone keeps a session cookie, never
              the desktop token.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={busy || token === undefined}
            onClick={() => void createPairing()}
          >
            Create pairing link
          </Button>
        </div>
        {token === undefined ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Pairing links are created from the desktop app. Open Settings there, or run the desktop
            build against this server.
          </p>
        ) : null}
        {pairing === null ? null : (
          <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-xs leading-5">
            <span className="font-mono text-sm tracking-widest text-foreground">{pairing.code}</span>
            <span className="break-all text-muted-foreground">{pairing.url}</span>
            <span className="text-muted-foreground">
              Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(pairing.url)}
            >
              Copy link
            </Button>
          </div>
        )}
        {actionError === null ? null : (
          <p role="alert" className="text-xs leading-5 text-error">
            {actionError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Paired devices</h3>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={token === undefined}
            onClick={() => void loadSessions()}
          >
            Refresh
          </Button>
        </div>
        {sessions.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">No device has paired yet.</p>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{session.deviceName}</span>
                  <span className="text-muted-foreground">
                    Last seen {new Date(session.lastSeenAt).toLocaleString()}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || session.revokedAt !== null}
                  onClick={() => void revoke(session.id)}
                >
                  {session.revokedAt === null ? 'Revoke' : 'Revoked'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        On a LAN, HTTP traffic is not encrypted. Use Tailscale Serve for HTTPS, or keep remote access
        to a trusted network.
      </p>

      <SaveBar
        dirty={controller.dirty}
        saving={controller.saving}
        error={controller.error}
        onReset={controller.reset}
      />
    </form>
  );
}
