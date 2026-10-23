import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { preferences } from '@neutrino/preferences';
import { defaultRailLayout, expandPanel } from '@neutrino/ui';
import { usePanelLayout } from '@/lib/panelLayouts';

beforeEach(() => {
  preferences.reset('editor.panels');
});

describe('usePanelLayout', () => {
  it('stores a surface’s layout under its own key in the synced preference, leaving the others', () => {
    preferences.set('editor.panels', { 'some-other-surface': { version: 1 } });
    const { result } = renderHook(() => usePanelLayout('photos-editor'));
    expect(result.current[0]).toBeNull();

    const layout = expandPanel(
      defaultRailLayout({ sides: ['right'], panels: [{ id: 'filters', side: 'right' }, { id: 'adjust', side: 'right' }] }),
      'adjust',
    );
    act(() => result.current[1](layout));

    expect(result.current[0]).toEqual(layout);
    expect(preferences.get('editor.panels')).toEqual({ 'some-other-surface': { version: 1 }, 'photos-editor': layout });
  });
});
