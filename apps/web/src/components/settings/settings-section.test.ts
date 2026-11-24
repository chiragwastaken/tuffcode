import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTION_LABEL,
  SETTINGS_SECTIONS,
  parseSettingsSection,
} from './settings-section';

describe('settings sections', () => {
  it('keeps the spec order', () => {
    expect(SETTINGS_SECTIONS).toEqual([
      'appearance',
      'providers',
      'models',
      'instructions',
      'agents',
      'instructions',
      'permissions',
      'terminal',
      'brain',
      'updates',
      'diagnostics',
      'keybindings',
      'capabilities',
      'about',
    ]);
  });

  it('labels every section', () => {
    expect(SETTINGS_SECTIONS.map((id) => SETTINGS_SECTION_LABEL[id])).toEqual([
      'Appearance',
      'Providers',
      'Models',
      'Instructions',
      'Agents and tools',
      'Instructions',
      'Permissions',
      'Terminal',
      'Brain',
      'Updates',
      'Diagnostics',
      'Keybindings',
      'Capabilities',
      'About',
    ]);
    expect(new Set(SETTINGS_SECTIONS.map((id) => SETTINGS_SECTION_LABEL[id])).size).toBe(
      SETTINGS_SECTIONS.length,
    );
  });

  it('defaults to the first section when the route has none', () => {
    expect(parseSettingsSection(undefined)).toBe(DEFAULT_SETTINGS_SECTION);
    expect(parseSettingsSection('')).toBe(DEFAULT_SETTINGS_SECTION);
    expect(DEFAULT_SETTINGS_SECTION).toBe('appearance');
  });

  it('accepts every known section', () => {
    for (const id of SETTINGS_SECTIONS) expect(parseSettingsSection(id)).toBe(id);
  });

  it('maps the retired general route to appearance', () => {
    expect(parseSettingsSection('general')).toBe('appearance');
  });

  it('rejects unknown sections', () => {
    expect(parseSettingsSection('nope')).toBeNull();
    expect(parseSettingsSection('General')).toBeNull();
  });
});
