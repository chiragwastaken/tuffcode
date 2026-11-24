import type { ReactNode } from 'react';

export interface SettingsSectionHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

export function SettingsSectionHeader({ title, description, actions }: SettingsSectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
