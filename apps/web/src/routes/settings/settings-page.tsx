import { EmptyState, ScrollArea, buttonVariants, cn } from '@tuffcode/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { Boxes, Info, Keyboard, Server, SlidersHorizontal } from 'lucide-react';
import {
  SETTINGS_SECTIONS,
  parseSettingsSection,
  type SettingsSection,
} from '../../components/settings/settings-section';
import { AboutSection } from './about-section';
import { GeneralSection } from './general-section';
import { KeybindingsSection } from './keybindings-section';
import { ModelsSection } from './models-section';
import { ProvidersSection } from './providers-section';

const SECTION_META = {
  general: { label: 'General', icon: SlidersHorizontal },
  providers: { label: 'Providers', icon: Server },
  models: { label: 'Models', icon: Boxes },
  keybindings: { label: 'Keybindings', icon: Keyboard },
  about: { label: 'About', icon: Info },
} satisfies Record<SettingsSection, { label: string; icon: typeof SlidersHorizontal }>;

function renderSection(section: SettingsSection) {
  switch (section) {
    case 'general':
      return <GeneralSection />;
    case 'providers':
      return <ProvidersSection />;
    case 'models':
      return <ModelsSection />;
    case 'keybindings':
      return <KeybindingsSection />;
    case 'about':
      return <AboutSection />;
  }
}

export interface SettingsPageProps {
  section?: string;
}

export function SettingsPage({ section }: SettingsPageProps) {
  const parsed = parseSettingsSection(section);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Settings sections"
        className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3"
      >
        <h1 className="px-2 pb-2 text-sm font-semibold text-foreground">Settings</h1>
        {SETTINGS_SECTIONS.map((id) => {
          const meta = SECTION_META[id];
          const Icon = meta.icon;
          const path = `/settings/${id}`;
          const active =
            pathname === path ||
            pathname === `${path}/` ||
            (id === 'general' && (pathname === '/settings' || pathname === '/settings/'));

          return (
            <Link
              key={id}
              to="/settings/{-$section}"
              params={{ section: id }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon strokeWidth={1.75} className="size-4 shrink-0" />
              {meta.label}
            </Link>
          );
        })}
      </nav>

      <ScrollArea className="h-full min-w-0 flex-1">
        <div className="mx-auto w-full max-w-3xl p-6">
          {parsed ? (
            renderSection(parsed)
          ) : (
            <EmptyState
              title="Unknown settings section"
              description="That section does not exist."
              action={
                <Link
                  to="/settings/{-$section}"
                  params={{}}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  Go to General
                </Link>
              }
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
