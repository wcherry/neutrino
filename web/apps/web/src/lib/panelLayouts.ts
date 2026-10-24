'use client';

import { useCallback, useMemo, useRef } from 'react';
import { usePreference } from '@neutrino/preferences';
import {
  collapseRail,
  dockPanel,
  expandPanel,
  locatePanel,
  normalizeRailLayout,
  type RailLayout,
  type RailSide,
  type RailSpec,
} from '@neutrino/ui';

/**
 * Where each surface's panel layout is kept: one synced `editor.panels` preference, a map from
 * surface to the `PanelRail` layout the user arranged there — which rail each panel is in, which
 * is open, sizes, floating windows. Synced, so an arrangement follows the user to another browser.
 *
 * The stored value is whatever an earlier build or another device wrote, so it is repaired
 * (`normalizeRailLayout`) against the panels the surface has now; nothing here trusts its shape.
 */

/** Every surface that hosts a `PanelRail`. A surface's id is the key its layout is stored under. */
export type PanelSurface = 'photos-editor' | 'docs-editor' | 'diagrams-editor' | 'drawing-editor' | 'sheets-editor' | 'slides-editor' | 'photos-library' | 'drive';

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

export interface SurfacePanels {
  /** The surface's layout, repaired against its panels — pass to `PanelRail` as `layout`. */
  layout: RailLayout;
  /** Pass to `PanelRail` as `onLayoutChange`. */
  setLayout: (layout: RailLayout) => void;
  /** Whether a panel can be seen: open in its rail, or floating. */
  isOpen: (id: string) => boolean;
  /** Show a panel — what a menu item or a "comment on this" action does. */
  open: (id: string) => void;
  /** Hide a panel: collapse its rail, or return a floating one to its rail, collapsed. */
  close: (id: string) => void;
  toggle: (id: string) => void;
}

/**
 * A surface's panels as state, for the editor that hosts them: the layout to hand `PanelRail`,
 * and the operations that replace each editor's old `show…` flags. Every panel is always a tab,
 * so "close" collapses rather than removes.
 */
export function useRailState(
  surface: PanelSurface,
  spec: RailSpec,
  defaultExpanded: Partial<Record<RailSide, string>> = {},
): SurfacePanels {
  const [stored, setStored] = usePanelLayout(surface);
  const specKey = `${spec.sides.join()}|${spec.panels.map((p) => `${p.id}:${p.side}`).join()}|${JSON.stringify(defaultExpanded)}`;
  const layout = useMemo(
    () => normalizeRailLayout(stored, spec, defaultExpanded),
    // The spec is rebuilt each render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, specKey],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const change = useCallback(
    (fn: (l: RailLayout) => RailLayout) => {
      const next = fn(layoutRef.current);
      if (next !== layoutRef.current) {
        layoutRef.current = next;
        setStored(next);
      }
    },
    [setStored],
  );

  const isOpen = useCallback((id: string) => {
    const at = locatePanel(layout, id);
    if (at === 'floating') return true;
    return !!at && layout.rails[at.side]?.expanded === id;
  }, [layout]);

  const open = useCallback((id: string) => change((l) => expandPanel(l, id)), [change]);

  const close = useCallback((id: string) => change((l) => {
    const at = locatePanel(l, id);
    if (at === 'floating') {
      const docked = dockPanel(l, id);
      const home = locatePanel(docked, id);
      return home && home !== 'floating' ? collapseRail(docked, home.side) : docked;
    }
    if (!at || l.rails[at.side]?.expanded !== id) return l;
    return collapseRail(l, at.side);
  }), [change]);

  const toggle = useCallback((id: string) => (isOpen(id) ? close(id) : open(id)), [isOpen, close, open]);

  return { layout, setLayout: setStored, isOpen, open, close, toggle };
}
