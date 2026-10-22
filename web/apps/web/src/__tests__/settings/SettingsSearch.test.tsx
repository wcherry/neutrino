import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REGISTRY } from '@neutrino/preferences';
import { SettingsSearch, searchSettings } from '@/app/(apps)/settings/SettingsSearch';

describe('searchSettings', () => {
  it('finds a preference by its label and says which tab it is on', () => {
    expect(searchSettings('week starts')).toEqual([
      { label: 'Week starts on', tab: 'calendar', where: 'Settings › Calendar' },
    ]);
  });

  it('finds a setting that lives in an editor, and says where instead of linking', () => {
    const [hit] = searchSettings('paragraphs break');
    expect(hit.tab).toBeUndefined();
    expect(hit.where).toBe('In the Docs editor');
  });

  it('finds tabs by name', () => {
    expect(searchSettings('security')).toContainEqual({ label: 'Security', tab: 'security', where: 'Settings' });
  });

  it('finds the display settings on the Appearance tab (stage 4)', () => {
    for (const label of ['Look', 'Density', 'Text size', 'Accent colour', 'Higher contrast']) {
      expect(searchSettings(label).find((r) => r.label === label)?.tab, label).toBe('appearance');
    }
  });

  it('knows how to describe every place the registry says a control lives', () => {
    // A preference registered with a new `section` would otherwise show as "Elsewhere".
    for (const spec of REGISTRY) {
      if (spec.section === 'none') continue;
      for (const r of searchSettings(spec.label)) {
        if (r.label === spec.label) expect(r.where).not.toBe('Elsewhere in the app');
      }
    }
  });
});

describe('SettingsSearch', () => {
  it('opens the tab a result is on and clears the search', async () => {
    const onOpenTab = vi.fn();
    render(<SettingsSearch onOpenTab={onOpenTab} />);
    const box = screen.getByRole('searchbox', { name: 'Search settings' });

    await userEvent.type(box, 'ai provider');
    await userEvent.click(screen.getByRole('button', { name: /AI provider/ }));

    expect(onOpenTab).toHaveBeenCalledWith('ai');
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('says so when nothing matches', async () => {
    render(<SettingsSearch onOpenTab={vi.fn()} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'zzz');
    expect(screen.getByText(/No settings match/)).toBeTruthy();
  });
});
