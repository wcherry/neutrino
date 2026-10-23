/**
 * The layout of a rail workspace, as plain data: which pane sits in which rail and in what order,
 * which one each rail has open, which panes float and where, and how big each pane is.
 *
 * It is kept apart from the components so the rules are testable without rendering, and so an app
 * can store it as a preference: every function here returns a new layout and never mutates, and
 * `normalizeLayout` turns whatever came back from storage into a layout that is valid for the panes
 * the app has today.
 *
 * Three rules hold for every layout these functions produce:
 *  - every pane is in exactly one place — one rail, or floating;
 *  - a rail has at most one pane expanded, and it is one of its own;
 *  - a floating pane remembers the rail (and position in it) it came from, so closing it puts it back.
 */

export type RailSide = 'left' | 'right' | 'top' | 'bottom';

export const RAIL_SIDES: readonly RailSide[] = ['left', 'right', 'top', 'bottom'];

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RailState {
  /** Pane ids in tab order. */
  panes: string[];
  /** The one expanded pane, or null when the rail is only its strip. */
  expanded: string | null;
}

export interface FloatingPane {
  rect: FloatRect;
  /** Where closing it returns it to. */
  home: RailSide;
  homeIndex: number;
}

export interface RailLayout {
  version: 1;
  rails: Partial<Record<RailSide, RailState>>;
  floating: Record<string, FloatingPane>;
  /** A pane's width in a side rail, or height in a top or bottom one, in px. */
  sizes: Record<string, number>;
}

/** What an app declares: its panes and the rails it has. */
export interface RailSpec {
  sides: readonly RailSide[];
  panes: readonly { id: string; side: RailSide }[];
}

export const MIN_PANE_SIZE = 160;
export const MAX_PANE_SIZE = 960;
export const DEFAULT_PANE_SIZE: Record<'vertical' | 'horizontal', number> = { vertical: 280, horizontal: 220 };
export const MIN_FLOAT_WIDTH = 200;
export const MIN_FLOAT_HEIGHT = 140;

export function isVertical(side: RailSide): boolean {
  return side === 'left' || side === 'right';
}

export function clampSize(size: number): number {
  return Math.round(Math.min(MAX_PANE_SIZE, Math.max(MIN_PANE_SIZE, size)));
}

function homeSide(spec: RailSpec, side: RailSide | undefined): RailSide {
  if (side && spec.sides.includes(side)) return side;
  return spec.sides[0] ?? 'left';
}

/** The layout an app starts from: each pane in its declared rail, in declaration order. */
export function defaultLayout(
  spec: RailSpec,
  expanded: Partial<Record<RailSide, string>> = {},
): RailLayout {
  const rails: RailLayout['rails'] = {};
  for (const side of spec.sides) rails[side] = { panes: [], expanded: null };
  for (const pane of spec.panes) rails[homeSide(spec, pane.side)]!.panes.push(pane.id);
  for (const side of spec.sides) {
    const want = expanded[side];
    if (want && rails[side]!.panes.includes(want)) rails[side]!.expanded = want;
  }
  return { version: 1, rails, floating: {}, sizes: {} };
}

/** Where a pane is: a rail and its index there, or `floating`. Null for a pane the layout lacks. */
export function locate(layout: RailLayout, paneId: string): { side: RailSide; index: number } | 'floating' | null {
  if (layout.floating[paneId]) return 'floating';
  for (const side of RAIL_SIDES) {
    const index = layout.rails[side]?.panes.indexOf(paneId) ?? -1;
    if (index >= 0) return { side, index };
  }
  return null;
}

function cloneRails(layout: RailLayout): RailLayout['rails'] {
  const rails: RailLayout['rails'] = {};
  for (const side of RAIL_SIDES) {
    const rail = layout.rails[side];
    if (rail) rails[side] = { panes: [...rail.panes], expanded: rail.expanded };
  }
  return rails;
}

/** The layout with `paneId` taken out of wherever it is, the source rail collapsing if it was open. */
function detach(layout: RailLayout, paneId: string): { layout: RailLayout; from: ReturnType<typeof locate> } {
  const from = locate(layout, paneId);
  const rails = cloneRails(layout);
  const floating = { ...layout.floating };
  if (from === 'floating') delete floating[paneId];
  else if (from) {
    const rail = rails[from.side]!;
    rail.panes.splice(from.index, 1);
    if (rail.expanded === paneId) rail.expanded = null;
  }
  return { layout: { ...layout, rails, floating }, from };
}

/** Open a pane: the one expanded in its rail (closing whichever was). A floating pane is already open. */
export function expandPane(layout: RailLayout, paneId: string): RailLayout {
  const at = locate(layout, paneId);
  if (!at || at === 'floating') return layout;
  if (layout.rails[at.side]!.expanded === paneId) return layout;
  const rails = cloneRails(layout);
  rails[at.side]!.expanded = paneId;
  return { ...layout, rails };
}

/** Collapse a rail to its strip. */
export function collapseRail(layout: RailLayout, side: RailSide): RailLayout {
  if (!layout.rails[side]?.expanded) return layout;
  const rails = cloneRails(layout);
  rails[side]!.expanded = null;
  return { ...layout, rails };
}

/** What a tab click does: open the pane, or collapse it if it is the one already open. */
export function togglePane(layout: RailLayout, paneId: string): RailLayout {
  const at = locate(layout, paneId);
  if (!at || at === 'floating') return layout;
  return layout.rails[at.side]!.expanded === paneId ? collapseRail(layout, at.side) : expandPane(layout, paneId);
}

/**
 * Put a pane into a rail at `index` (the end by default) and open it there. Moving within one rail
 * reorders it; `index` counts positions in the rail as it is before the move.
 */
export function movePane(layout: RailLayout, paneId: string, side: RailSide, index?: number): RailLayout {
  if (!layout.rails[side]) return layout;
  const { layout: without, from } = detach(layout, paneId);
  if (!from) return layout;
  const rails = cloneRails(without);
  const target = rails[side]!;
  let at = index ?? target.panes.length;
  // The index was read off the rail with the pane still in it; taking it out shifts what follows.
  if (from !== 'floating' && from.side === side && from.index < at) at -= 1;
  target.panes.splice(Math.max(0, Math.min(at, target.panes.length)), 0, paneId);
  target.expanded = paneId;
  return { ...without, rails };
}

/** Lift a pane out of its rail into a floating window, remembering where to return it. */
export function floatPane(layout: RailLayout, paneId: string, rect: FloatRect): RailLayout {
  const at = locate(layout, paneId);
  if (!at) return layout;
  if (at === 'floating') return setFloatRect(layout, paneId, rect);
  const { layout: without } = detach(layout, paneId);
  return {
    ...without,
    floating: { ...without.floating, [paneId]: { rect: normalizeRect(rect), home: at.side, homeIndex: at.index } },
  };
}

/** Close a floating pane: back into the rail it came from, at the place it left, and open. */
export function dockPane(layout: RailLayout, paneId: string): RailLayout {
  const entry = layout.floating[paneId];
  if (!entry) return layout;
  const side = layout.rails[entry.home] ? entry.home : (RAIL_SIDES.find((s) => layout.rails[s]) ?? null);
  if (!side) return layout;
  const { layout: without } = detach(layout, paneId);
  const rails = cloneRails(without);
  const rail = rails[side]!;
  rail.panes.splice(Math.min(entry.homeIndex, rail.panes.length), 0, paneId);
  rail.expanded = paneId;
  return { ...without, rails };
}

export function setFloatRect(layout: RailLayout, paneId: string, rect: FloatRect): RailLayout {
  const entry = layout.floating[paneId];
  if (!entry) return layout;
  return { ...layout, floating: { ...layout.floating, [paneId]: { ...entry, rect: normalizeRect(rect) } } };
}

export function resizePane(layout: RailLayout, paneId: string, size: number): RailLayout {
  const next = clampSize(size);
  if (layout.sizes[paneId] === next) return layout;
  return { ...layout, sizes: { ...layout.sizes, [paneId]: next } };
}

export function paneSize(layout: RailLayout, paneId: string, side: RailSide): number {
  return layout.sizes[paneId] ?? DEFAULT_PANE_SIZE[isVertical(side) ? 'vertical' : 'horizontal'];
}

function normalizeRect(rect: FloatRect): FloatRect {
  return {
    x: Math.round(Math.max(0, rect.x)),
    y: Math.round(Math.max(0, rect.y)),
    width: Math.round(Math.max(MIN_FLOAT_WIDTH, rect.width)),
    height: Math.round(Math.max(MIN_FLOAT_HEIGHT, rect.height)),
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A layout that is valid for `spec`, from anything — a stored preference written by an older
 * build, another device with different panes, or nothing at all. Unknown panes and rails are
 * dropped, a pane that appears twice keeps its first place, panes the stored layout never saw go
 * to their declared rail, and an `expanded` that is not in its rail is cleared. What survives keeps
 * the user's arrangement.
 */
export function normalizeLayout(
  raw: unknown,
  spec: RailSpec,
  expanded: Partial<Record<RailSide, string>> = {},
): RailLayout {
  const base = defaultLayout(spec, expanded);
  const r = raw as Partial<RailLayout> | null | undefined;
  if (!r || typeof r !== 'object' || r.version !== 1) return base;

  const known = new Map(spec.panes.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const rails: RailLayout['rails'] = {};
  for (const side of spec.sides) rails[side] = { panes: [], expanded: null };

  for (const side of spec.sides) {
    const stored = (r.rails as Record<string, RailState | undefined> | undefined)?.[side];
    if (!stored || !Array.isArray(stored.panes)) continue;
    for (const id of stored.panes) {
      if (typeof id === 'string' && known.has(id) && !placed.has(id)) {
        rails[side]!.panes.push(id);
        placed.add(id);
      }
    }
    if (typeof stored.expanded === 'string' && rails[side]!.panes.includes(stored.expanded)) {
      rails[side]!.expanded = stored.expanded;
    }
  }

  const floating: RailLayout['floating'] = {};
  for (const [id, entry] of Object.entries((r.floating ?? {}) as Record<string, Partial<FloatingPane>>)) {
    const rect = entry?.rect as Partial<FloatRect> | undefined;
    if (!known.has(id) || placed.has(id) || !rect) continue;
    if (![rect.x, rect.y, rect.width, rect.height].every(finite)) continue;
    floating[id] = {
      rect: normalizeRect(rect as FloatRect),
      home: homeSide(spec, entry.home),
      homeIndex: finite(entry.homeIndex) ? Math.max(0, Math.floor(entry.homeIndex)) : 0,
    };
    placed.add(id);
  }

  for (const pane of spec.panes) {
    if (!placed.has(pane.id)) rails[homeSide(spec, pane.side)]!.panes.push(pane.id);
  }

  const sizes: RailLayout['sizes'] = {};
  for (const [id, size] of Object.entries((r.sizes ?? {}) as Record<string, unknown>)) {
    if (known.has(id) && finite(size)) sizes[id] = clampSize(size);
  }

  return { version: 1, rails, floating, sizes };
}

/** Whether two layouts describe the same arrangement (for skipping a no-op write to storage). */
export function sameLayout(a: RailLayout, b: RailLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
