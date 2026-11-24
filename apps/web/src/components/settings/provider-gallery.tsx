import { Badge, cn, focusRing } from '@tuffcode/ui';
import {
  Bot,
  Braces,
  Cloud,
  Flame,
  Gem,
  HardDrive,
  KeyRound,
  Laptop,
  Moon,
  Plug,
  Server,
  Sparkles,
  SquareTerminal,
  Users,
  Wind,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  PROVIDER_GROUPS,
  authModeLabel,
  presetsInGroup,
  type ProviderIconKey,
  type ProviderPreset,
} from './provider-presets';

const ICONS: Record<ProviderIconKey, LucideIcon> = {
  sparkles: Sparkles,
  bot: Bot,
  gem: Gem,
  wind: Wind,
  flame: Flame,
  'hard-drive': HardDrive,
  server: Server,
  laptop: Laptop,
  terminal: SquareTerminal,
  plug: Plug,
  wrench: Wrench,
  cloud: Cloud,
  braces: Braces,
  moon: Moon,
  users: Users,
  key: KeyRound,
};

export function PresetIcon({ icon, className }: { icon: ProviderIconKey; className?: string }) {
  const Icon = ICONS[icon] ?? Wrench;
  return <Icon aria-hidden="true" strokeWidth={1.75} className={className} />;
}

export interface SubscriptionCheck {
  signedIn?: boolean;
  cliPath?: string;
  detail?: string;
}

export interface ProviderGalleryProps {
  checks: Record<string, SubscriptionCheck | undefined>;
  onSelect: (preset: ProviderPreset) => void;
}

function SubscriptionStatus({ check }: { check: SubscriptionCheck | undefined }) {
  if (!check) {
    return (
      <span className="text-xs text-muted-foreground">
        Sign in to detect the CLI and your account.
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {check.signedIn === true ? (
        <Badge variant="success">Signed in</Badge>
      ) : check.signedIn === false ? (
        <Badge variant="warning">Not signed in</Badge>
      ) : (
        <Badge>Status unknown</Badge>
      )}
      <span
        className="truncate text-xs text-muted-foreground"
        title={check.cliPath ?? check.detail}
      >
        {check.cliPath ?? check.detail ?? 'CLI status unavailable'}
      </span>
    </span>
  );
}

export function ProviderGallery({ checks, onSelect }: ProviderGalleryProps) {
  return (
    <div className="flex flex-col gap-6">
      {PROVIDER_GROUPS.map((group) => {
        const presets = presetsInGroup(group.id);
        if (presets.length === 0) return null;

        return (
          <section key={group.id} aria-labelledby={`provider-group-${group.id}`}>
            <div className="flex flex-col gap-0.5 pb-2">
              <h3
                id={`provider-group-${group.id}`}
                className="text-sm font-semibold text-foreground"
              >
                {group.title}
              </h3>
              <p className="text-xs leading-5 text-muted-foreground">{group.description}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {presets.map((preset) => {
                const check = checks[preset.id];

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onSelect(preset)}
                    className={cn(
                      'group flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left',
                      'transition-colors duration-150 hover:bg-accent',
                      focusRing,
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                        <PresetIcon icon={preset.icon} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {preset.label}
                      </span>
                      <Badge variant={preset.group === 'subscriptions' ? 'primary' : 'neutral'}>
                        {authModeLabel(preset.auth)}
                      </Badge>
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      {preset.description}
                    </span>
                    {preset.group === 'subscriptions' ? <SubscriptionStatus check={check} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
