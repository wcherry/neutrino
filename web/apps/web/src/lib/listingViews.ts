'use client';

import { useCallback, useState } from 'react';
import { preferences, usePreference } from '@neutrino/preferences';
import type { SortDir, SortField, ViewMode } from '@neutrino/ui';

/**
 * Default views (customization roadmap U9): each listing remembers its own view and order, and
 * the choice follows the user to their other devices (`listing.views`, one synced object).
 *
 * Choosing a view or a sort in a listing *is* setting its default — there is no separate
 * "make default" step to forget. Settings › Appearance lists them too, to reset one.
 */

export type ListingId =
  | 'drive' | 'recent' | 'starred' | 'shared' | 'tag' | 'trash'
  | 'docs' | 'sheets' | 'slides' | 'drawings' | 'diagrams' | 'notes';

export interface ListingDefaults {
  view: ViewMode;
  sort: SortField;
  dir: SortDir;
  /**
   * The view in the new looks when the user has not chosen one: the Drive boards show a list
   * (look-and-feel roadmap §5). Classic keeps `view`, which is what each listing always opened in.
   */
  flowView?: ViewMode;
}

const VIEWS: readonly ViewMode[] = ['large', 'small', 'list'];
const SORTS: readonly SortField[] = ['name', 'size', 'createdAt', 'updatedAt'];
const DIRS: readonly SortDir[] = ['asc', 'desc'];

interface Stored { view?: ViewMode; sort?: SortField; dir?: SortDir }

/** One listing's stored choice, with anything that is not a legal value dropped. */
export function storedView(all: unknown, id: ListingId): Stored {
  const raw = all && typeof all === 'object' ? (all as Record<string, unknown>)[id] : undefined;
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  return {
    view: VIEWS.includes(r.view as ViewMode) ? (r.view as ViewMode) : undefined,
    sort: SORTS.includes(r.sort as SortField) ? (r.sort as SortField) : undefined,
    dir: DIRS.includes(r.dir as SortDir) ? (r.dir as SortDir) : undefined,
  };
}

function remember(id: ListingId, patch: Stored): void {
  const all = (preferences.get('listing.views') ?? {}) as Record<string, Stored>;
  preferences.set('listing.views', { ...all, [id]: { ...storedView(all, id), ...patch } });
}

/** Forget a listing's choice, so it opens as the product (or the look) has it. */
export function resetListingView(id: ListingId): void {
  const all = { ...((preferences.get('listing.views') ?? {}) as Record<string, Stored>) };
  delete all[id];
  preferences.set('listing.views', Object.keys(all).length ? all : null);
}

export function useListingView(id: ListingId, defaults: ListingDefaults) {
  const [all] = usePreference('listing.views');
  const [look] = usePreference('appearance.look');
  const stored = storedView(all, id);
  const view = stored.view ?? (look !== 'classic' && defaults.flowView ? defaults.flowView : defaults.view);
  // The order is page state as well as a preference: a listing re-sorts the moment it is clicked,
  // before the save round-trips.
  const [sort, setSortState] = useState<SortField>(stored.sort ?? defaults.sort);
  const [dir, setDirState] = useState<SortDir>(stored.dir ?? defaults.dir);

  const setView = useCallback((next: ViewMode) => remember(id, { view: next }), [id]);
  const setSort = useCallback((field: SortField, nextDir: SortDir) => {
    setSortState(field);
    setDirState(nextDir);
    remember(id, { sort: field, dir: nextDir });
  }, [id]);

  return { view, sort, dir, setView, setSort };
}
