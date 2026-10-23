import { describe, it, expect } from 'vitest';
import { contrastOnWhite, orgChanges, ORG_KEYS } from '../../app/(apps)/admin/OrganisationTab';

describe('Admin › Organisation', () => {
  it('checks an accent against white the way the server does', () => {
    expect(contrastOnWhite('#3346e8')!).toBeCloseTo(6.6, 1);
    expect(contrastOnWhite('#ffd400')!).toBeLessThan(4.5);
    expect(contrastOnWhite('red')).toBeNull();
  });

  it('sends only the rows that changed, and null for a default removed', () => {
    const before = [
      { key: 'appearance.look', on: true, value: 'precision', locked: true },
      { key: 'keyboard.preset', on: false, value: 'neutrino', locked: false },
      { key: 'docs.spellCheck', on: true, value: true, locked: false },
    ];
    const after = [
      { key: 'appearance.look', on: false, value: 'precision', locked: false },
      { key: 'keyboard.preset', on: true, value: 'google', locked: false },
      { key: 'docs.spellCheck', on: true, value: true, locked: false },
    ];
    expect(orgChanges(before, after)).toEqual({
      'appearance.look': null,
      'keyboard.preset': { value: 'google', locked: false },
    });
  });

  it('offers a default for every key an organisation may set, except the app list', () => {
    const keys = ORG_KEYS.map((s) => s.key);
    expect(keys).toContain('appearance.look');
    expect(keys).toContain('ai.provider');
    expect(keys).not.toContain('apps.enabled');
    expect(keys).not.toContain('keyboard.bindings');
  });
});
