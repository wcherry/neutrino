/**
 * The layout of a rail workspace, as plain data: which panel sits in which rail and in what order,
 * which one each rail has open, which panels float and where, and how big each panel is.
 *
 * It is kept apart from the components so the rules are testable without rendering, and so an app
 * can store it as a preference: every function here returns a new layout and never mutates, and
 * `normalizeLayout` turns whatever came back from storage into a layout that is valid for the panels
 * the app has today.
 *
 * Three rules hold for every layout these functions produce:
 *  - every panel is in exactly one place — one rail, or floating;
 *  - a rail has at most one panel expanded, and it is one of its own;
 *  - a floating panel remembers the rail (and position in it) it came from, so closing it puts it back.
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
  /** Panel ids in tab order. */
  panels: string[];
  /** The one expanded panel, or null when the rail is only its strip. */
  expanded: string | null;
}

export interface FloatingPanel {
  rect: FloatRect;
  /** Where closing it returns it to. */
  home: RailSide;
  homeIndex: number;
}

export interface RailLayout {
  version: 1;
  rails: Partial<Record<RailSide, RailState>>;
  floating: Record<string, FloatingPanel>;
  /** A panel's width in a side rail, or height in a top or bottom one, in px. */
  sizes: Record<string, number>;
}

/** What an app declares: its panels and the rails it has. */
export interface RailSpec {
  sides: readonly RailSide[];
  panels: readonly { id: string; side: RailSide }[];
}

export const MIN_PANEL_SIZE = 160;
export const MAX_PANEL_SIZE = 960;
export const DEFAULT_PANEL_SIZE: Record<'vertical' | 'horizontal', number> = { vertical: 280, horizontal: 220 };
export const MIN_FLOAT_WIDTH = 200;
export const MIN_FLOAT_HEIGHT = 140;

export function isVertical(side: RailSide): boolean {
  return side === 'left' || side === 'right';
}

export function clampSize(size: number): number {
  return Math.round(Math.min(MAX_PANEL_SIZE, Math.max(MIN_PANEL_SIZE, size)));
}

function homeSide(spec: RailSpec, side: RailSide | undefined): RailSide {
  if (side && spec.sides.includes(side)) return side;
  return spec.sides[0] ?? 'left';
}

/** The layout an app starts from: each panel in its declared rail, in declaration order. */
export function defaultLayout(
  spec: RailSpec,
  expanded: Partial<Record<RailSide, string>> = {},
): RailLayout {
  const rails: RailLayout['rails'] = {};
  for (const side of spec.sides) rails[side] = { panels: [], expanded: null };
  for (const panel of spec.panels) rails[homeSide(spec, panel.side)]!.panels.push(panel.id);
  for (const side of spec.sides) {
    const want = expanded[side];
    if (want && rails[side]!.panels.includes(want)) rails[side]!.expanded = want;
  }
  return { version: 1, rails, floating: {}, sizes: {} };
}

/** Where a panel is: a rail and its index there, or `floating`. Null for a panel the layout lacks. */
export function locate(layout: RailLayout, panelId: string): { side: RailSide; index: number } | 'floating' | null {
  if (layout.floating[panelId]) return 'floating';
  for (const side of RAIL_SIDES) {
    const index = layout.rails[side]?.panels.indexOf(panelId) ?? -1;
    if (index >= 0) return { side, index };
  }
  return null;
}

function cloneRails(layout: RailLayout): RailLayout['rails'] {
  const rails: RailLayout['rails'] = {};
  for (const side of RAIL_SIDES) {
    const rail = layout.rails[side];
    if (rail) rails[side] = { panels: [...rail.panels], expanded: rail.expanded };
  }
  return rails;
}

/** The layout with `panelId` taken out of wherever it is, the source rail collapsing if it was open. */
function detach(layout: RailLayout, panelId: string): { layout: RailLayout; from: ReturnType<typeof locate> } {
  const from = locate(layout, panelId);
  const rails = cloneRails(layout);
  const floating = { ...layout.floating };
  if (from === 'floating') delete floating[panelId];
  else if (from) {
    const rail = rails[from.side]!;
    rail.panels.splice(from.index, 1);
    if (rail.expanded === panelId) rail.expanded = null;
  }
  return { layout: { ...layout, rails, floating }, from };
}

/** Open a panel: the one expanded in its rail (closing whichever was). A floating panel is already open. */
export function expandPanel(layout: RailLayout, panelId: string): RailLayout {
  const at = locate(layout, panelId);
  if (!at || at === 'floating') return layout;
  if (layout.rails[at.side]!.expanded === panelId) return layout;
  const rails = cloneRails(layout);
  rails[at.side]!.expanded = panelId;
  return { ...layout, rails };
}

/** Collapse a rail to its strip. */
export function collapseRail(layout: RailLayout, side: RailSide): RailLayout {
  if (!layout.rails[side]?.expanded) return layout;
  const rails = cloneRails(layout);
  rails[side]!.expanded = null;
  return { ...layout, rails };
}

/** What a tab click does: open the panel, or collapse it if it is the one already open. */
export function togglePanel(layout: RailLayout, panelId: string): RailLayout {
  const at = locate(layout, panelId);
  if (!at || at === 'floating') return layout;
  return layout.rails[at.side]!.expanded === panelId ? collapseRail(layout, at.side) : expandPanel(layout, panelId);
}

/**
 * Put a panel into a rail at `index` (the end by default) and open it there. Moving within one rail
 * reorders it; `index` counts positions in the rail as it is before the move.
 */
export function movePanel(layout: RailLayout, panelId: string, side: RailSide, index?: number): RailLayout {
  if (!layout.rails[side]) return layout;
  const { layout: without, from } = detach(layout, panelId);
  if (!from) return layout;
  const rails = cloneRails(without);
  const target = rails[side]!;
  let at = index ?? target.panels.length;
  // The index was read off the rail with the panel still in it; taking it out shifts what follows.
  if (from !== 'floating' && from.side === side && from.index < at) at -= 1;
  target.panels.splice(Math.max(0, Math.min(at, target.panels.length)), 0, panelId);
  target.expanded = panelId;
  return { ...without, rails };
}

/** Lift a panel out of its rail into a floating window, remembering where to return it. */
export function floatPanel(layout: RailLayout, panelId: string, rect: FloatRect): RailLayout {
  const at = locate(layout, panelId);
  if (!at) return layout;
  if (at === 'floating') return setFloatRect(layout, panelId, rect);
  const { layout: without } = detach(layout, panelId);
  return {
    ...without,
    floating: { ...without.floating, [panelId]: { rect: normalizeRect(rect), home: at.side, homeIndex: at.index } },
  };
}

/** Close a floating panel: back into the rail it came from, at the place it left, and open. */
export function dockPanel(layout: RailLayout, panelId: string): RailLayout {
  const entry = layout.floating[panelId];
  if (!entry) return layout;
  const side = layout.rails[entry.home] ? entry.home : (RAIL_SIDES.find((s) => layout.rails[s]) ?? null);
  if (!side) return layout;
  const { layout: without } = detach(layout, panelId);
  const rails = cloneRails(without);
  const rail = rails[side]!;
  rail.panels.splice(Math.min(entry.homeIndex, rail.panels.length), 0, panelId);
  rail.expanded = panelId;
  return { ...without, rails };
}

export function setFloatRect(layout: RailLayout, panelId: string, rect: FloatRect): RailLayout {
  const entry = layout.floating[panelId];
  if (!entry) return layout;
  return { ...layout, floating: { ...layout.floating, [panelId]: { ...entry, rect: normalizeRect(rect) } } };
}

export function resizePanel(layout: RailLayout, panelId: string, size: number): RailLayout {
  const next = clampSize(size);
  if (layout.sizes[panelId] === next) return layout;
  return { ...layout, sizes: { ...layout.sizes, [panelId]: next } };
}

export function panelSize(layout: RailLayout, panelId: string, side: RailSide): number {
  return layout.sizes[panelId] ?? DEFAULT_PANEL_SIZE[isVertical(side) ? 'vertical' : 'horizontal'];
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
 * build, another device with different panels, or nothing at all. Unknown panels and rails are
 * dropped, a panel that appears twice keeps its first place, panels the stored layout never saw go
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

  const known = new Map(spec.panels.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const rails: RailLayout['rails'] = {};
  for (const side of spec.sides) rails[side] = { panels: [], expanded: null };

  for (const side of spec.sides) {
    const stored = (r.rails as Record<string, RailState | undefined> | undefined)?.[side];
    if (!stored || !Array.isArray(stored.panels)) continue;
    for (const id of stored.panels) {
      if (typeof id === 'string' && known.has(id) && !placed.has(id)) {
        rails[side]!.panels.push(id);
        placed.add(id);
      }
    }
    if (typeof stored.expanded === 'string' && rails[side]!.panels.includes(stored.expanded)) {
      rails[side]!.expanded = stored.expanded;
    }
  }

  const floating: RailLayout['floating'] = {};
  for (const [id, entry] of Object.entries((r.floating ?? {}) as Record<string, Partial<FloatingPanel>>)) {
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

  for (const panel of spec.panels) {
    if (!placed.has(panel.id)) rails[homeSide(spec, panel.side)]!.panels.push(panel.id);
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
