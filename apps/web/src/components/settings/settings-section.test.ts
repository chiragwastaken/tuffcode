import { describe, expect, it } from 'vitest';
import { parseSettingsSection } from './settings-section';

describe('parseSettingsSection', () => {
  it('defaults to general when the route has no section', () => {
    expect(parseSettingsSection(undefined)).toBe('general');
    expect(parseSettingsSection('')).toBe('general');
  });

  it('accepts every known section', () => {
    expect(parseSettingsSection('general')).toBe('general');
    expect(parseSettingsSection('providers')).toBe('providers');
    expect(parseSettingsSection('models')).toBe('models');
    expect(parseSettingsSection('keybindings')).toBe('keybindings');
    expect(parseSettingsSection('about')).toBe('about');
  });

  it('rejects unknown sections', () => {
    expect(parseSettingsSection('nope')).toBeNull();
  });
});
