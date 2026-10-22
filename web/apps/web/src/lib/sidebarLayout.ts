import { Folder } from 'lucide-react';
import type { NavSection } from '@neutrino/layout';
import { preferences } from '@neutrino/preferences';

/**
 * The user's own sidebar (customization roadmap U8): folders pinned under the Drive views, apps
 * in their order, and entries or whole sections hidden. One synced preference (`shell.sidebar`),
 * applied to the sections `navSections.ts` builds — in both shells — so a customised sidebar is the
 * same on every device. Hiding is the user's choice on top of the administrator's (`apps.enabled`):
 * an app the instance does not offer is gone before this runs, and cannot be shown again here.
 */

export interface PinnedFolder {
  id: string;
  name: string;
}

export interface SidebarLayout {
  /** Item ids (`docs`, `recent` …) and section ids (`section:tags`, `section:team`) to leave out. */
  hidden: string[];
  /** App item ids in the user's order; apps not named keep their place after these. */
  order: string[];
  pinned: PinnedFolder[];
}

/** Pins are a convenience, not a library: a short list is the point of them. */
export const MAX_PINS = 12;

/** The stored layout, with anything malformed dropped. */
export function readLayout(raw: unknown = preferences.get('shell.sidebar')): SidebarLayout {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const pinned = Array.isArray(r.pinned)
    ? r.pinned
        .filter((p): p is PinnedFolder => !!p && typeof p === 'object' && typeof (p as PinnedFolder).id === 'string' && typeof (p as PinnedFolder).name === 'string')
        .slice(0, MAX_PINS)
    : [];
  return { hidden: strings(r.hidden), order: strings(r.order), pinned };
}

function write(next: SidebarLayout): void {
  const empty = next.hidden.length === 0 && next.order.length === 0 && next.pinned.length === 0;
  preferences.set('shell.sidebar', empty ? null : { ...next });
}

export function isPinned(folderId: string): boolean {
  return readLayout().pinned.some((p) => p.id === folderId);
}

export function pinFolder(folder: PinnedFolder): boolean {
  const layout = readLayout();
  if (layout.pinned.some((p) => p.id === folder.id) || layout.pinned.length >= MAX_PINS) return false;
  write({ ...layout, pinned: [...layout.pinned, { id: folder.id, name: folder.name }] });
  return true;
}

export function unpinFolder(folderId: string): void {
  const layout = readLayout();
  write({ ...layout, pinned: layout.pinned.filter((p) => p.id !== folderId) });
}

export function setHidden(id: string, hidden: boolean): void {
  const layout = readLayout();
  const rest = layout.hidden.filter((h) => h !== id);
  write({ ...layout, hidden: hidden ? [...rest, id] : rest });
}

/** Move app `id` one place up (-1) or down (+1) within `current`, the order as shown. */
export function moveApp(current: string[], id: string, delta: -1 | 1): void {
  const i = current.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= current.length) return;
  const order = [...current];
  [order[i], order[j]] = [order[j], order[i]];
  write({ ...readLayout(), order });
}

export function resetLayout(): void {
  preferences.set('shell.sidebar', null);
}

/** The pinned folder's address: My Drive opened at it. */
export function pinnedHref(folderId: string): string {
  return `/drive?folder=${encodeURIComponent(folderId)}`;
}

/** `sections` as this user has arranged them. Pure, for the tests. */
export function applyLayout(sections: NavSection[], layout: SidebarLayout): NavSection[] {
  const out: NavSection[] = [];
  for (const section of sections) {
    if (layout.hidden.includes(`section:${section.id}`)) continue;
    let items = section.items.filter((item) => !layout.hidden.includes(item.id));
    if (section.id === 'apps' && layout.order.length) {
      const rank = (id: string) => {
        const i = layout.order.indexOf(id);
        return i < 0 ? layout.order.length + items.findIndex((x) => x.id === id) : i;
      };
      items = [...items].sort((a, b) => rank(a.id) - rank(b.id));
    }
    if (items.length) out.push({ ...section, items });
    // Pins sit straight after the Drive views they belong to.
    if (section.id === 'main' && layout.pinned.length) {
      out.push({
        id: 'pinned',
        label: 'Pinned',
        items: layout.pinned.map((p) => ({ id: `pin-${p.id}`, label: p.name, icon: Folder, href: pinnedHref(p.id) })),
      });
    }
  }
  return out;
}
