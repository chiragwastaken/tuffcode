export const SETTINGS_SECTIONS = [
  'general',
  'providers',
  'models',
  'keybindings',
  'about',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function parseSettingsSection(value: string | undefined): SettingsSection | null {
  if (value === undefined || value === '') return 'general';
  return (SETTINGS_SECTIONS as readonly string[]).includes(value)
    ? (value as SettingsSection)
    : null;
}
