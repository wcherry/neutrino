import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { preferences } from '@neutrino/preferences';
import { resetListingView, storedView, useListingView } from '@/lib/listingViews';

beforeEach(() => {
  preferences.reset('listing.views');
  preferences.reset('appearance.look');
});

describe('default views (U9)', () => {
  it('opens each listing as it comes until a view is chosen, then remembers it per listing', () => {
    const { result } = renderHook(() => useListingView('recent', { view: 'large', sort: 'updatedAt', dir: 'desc', flowView: 'list' }));
    expect(result.current.view).toBe('large');
    act(() => result.current.setView('small'));
    act(() => result.current.setSort('name', 'asc'));
    expect(result.current.view).toBe('small');
    expect(storedView(preferences.get('listing.views'), 'recent')).toEqual({ view: 'small', sort: 'name', dir: 'asc' });
    expect(storedView(preferences.get('listing.views'), 'drive')).toEqual({});
  });

  it('opens as a list in the new looks, the way the Drive boards do, unless one was chosen', () => {
    preferences.set('appearance.look', 'precision');
    const { result } = renderHook(() => useListingView('drive', { view: 'large', sort: 'updatedAt', dir: 'desc', flowView: 'list' }));
    expect(result.current.view).toBe('list');
    act(() => result.current.setView('large'));
    expect(result.current.view).toBe('large');
    act(() => resetListingView('drive'));
    expect(result.current.view).toBe('list');
  });

  it('drops what is not a view or a sort', () => {
    expect(storedView({ drive: { view: 'huge', sort: 'name', dir: 'up' } }, 'drive')).toEqual({ view: undefined, sort: 'name', dir: undefined });
  });
});
