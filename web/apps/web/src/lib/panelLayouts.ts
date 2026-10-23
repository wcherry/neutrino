'use client';

import { useCallback } from 'react';
import { usePreference } from '@neutrino/preferences';
import type { RailLayout } from '@neutrino/ui';

/**
 * Where each surface's panel layout is kept: one synced `editor.panels` preference, a map from
 * surface to the `PanelRail` layout the user arranged there — which rail each panel is in, which
 * is open, sizes, floating windows. Synced, so an arrangement follows the user to another browser.
 *
 * The stored value is whatever an earlier build or another device wrote, so it is handed to
 * `PanelRail` as-is and repaired there (`normalizeRailLayout`) against the panels the surface has
 * now; nothing here trusts its shape.
 */

/** Every surface that hosts a `PanelRail`. A surface's id is the key its layout is stored under. */
export type PanelSurface = 'photos-editor';

/** One surface's stored layout (null when the user has never arranged it) and its setter. */
export function usePanelLayout(surface: PanelSurface): [unknown, (layout: RailLayout) => void] {
  const [all, setAll] = usePreference('editor.panels');
  const stored = (all ?? {})[surface] ?? null;
  const setLayout = useCallback(
    (layout: RailLayout) => setAll({ ...(all ?? {}), [surface]: layout }),
    [all, setAll, surface],
  );
  return [stored, setLayout];
}
