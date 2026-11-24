import { Card, CardDescription, CardHeader, CardTitle, buttonVariants } from '@tuffcode/ui';
import { BookOpen, ExternalLink, GitBranch, LifeBuoy } from 'lucide-react';
import { SettingsRow } from '../../components/settings/settings-row';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useAppStore } from '../../store/app-store';

const REPOSITORY_URL = 'https://github.com/tuffcode-net/tuffcode';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const ISSUES_URL = `${REPOSITORY_URL}/issues`;

export function AboutSection() {
  const version = useAppStore((state) => state.bootstrap?.version);
  const platform = useAppStore((state) => state.bootstrap?.platform);

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="About"
        description="Build information and where to report a problem. Everything the app stores stays on this machine."
      />

      <Card>
        <CardHeader>
          <CardTitle>Tuffcode</CardTitle>
          <CardDescription>Local-first desktop app for agentic coding.</CardDescription>
        </CardHeader>

        <div className="divide-y divide-border border-t border-border">
          <SettingsRow label="Version" description="Version reported by the desktop app.">
            <span className="flex h-9 items-center text-sm tabular-nums text-foreground">
              {version ?? 'Unknown'}
            </span>
          </SettingsRow>

          <SettingsRow label="Platform" description="Operating system this build runs on.">
            <span className="flex h-9 items-center text-sm text-foreground">
              {platform ?? 'Unknown'}
            </span>
          </SettingsRow>

          <SettingsRow label="License" description="Tuffcode is released under the MIT license.">
            <span className="flex h-9 items-center text-sm text-foreground">MIT</span>
          </SettingsRow>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
          <CardDescription>Source, releases, and the issue tracker.</CardDescription>
        </CardHeader>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <GitBranch strokeWidth={1.75} />
            Source
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ExternalLink strokeWidth={1.75} />
            Releases
          </a>
          <a
            href={ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <LifeBuoy strokeWidth={1.75} />
            Report an issue
          </a>
          <a
            href={`${REPOSITORY_URL}#readme`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <BookOpen strokeWidth={1.75} />
            Readme
          </a>
        </div>
      </Card>
    </div>
  );
}
