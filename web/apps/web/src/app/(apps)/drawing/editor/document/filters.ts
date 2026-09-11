/**
 * Filters — effects applied to a layer's own pixels, non-destructively.
 *
 * Redesign §4 asks a filter to carry its type, parameters, target, mask,
 * ordering and a rendered fallback. Five of those are here and the sixth falls
 * out of the architecture:
 *
 * - **type and parameters** are this file;
 * - **target** is the node the filter list hangs off — a filter is a field on a
 *   layer rather than a free-floating object pointing at one, because a filter
 *   with no layer is not a thing the editor can show you;
 * - **ordering** is the array's own order, applied first to last;
 * - **mask** is the layer's mask, applied *after* the filter stack, so a
 *   masked, blurred layer is a blur confined to the mask. One mask per layer and
 *   not one per filter: a second channel to paint would need a second way to
 *   select which one you are painting, and no editor offers that for the same
 *   reason;
 * - **rendered fallback** costs nothing, because the OpenRaster writer
 *   rasterises every layer through the same compositor the screen uses, so the
 *   PNG in `data/` is the filtered result and the parameters ride along in the
 *   manifest.
 *
 * The pixel arithmetic is in `render/imageFilters.ts`. This file is the
 * vocabulary, and it is deliberately free of canvas so the defaults and the
 * clamping can be tested without one.
 */

import { newId } from './ids';

export type FilterKind = 'blur' | 'sharpen' | 'pixelate' | 'drop-shadow' | 'glow' | 'noise';

interface FilterBase {
  id: string;
  enabled: boolean;
}

/**
 * Gaussian, in canvas pixels.
 *
 * `radius` is the **standard deviation**, which is what CSS's `filter: blur()`
 * and SVG's `stdDeviation` take — so the number means the same thing here, in
 * an SVG export and in a browser, and the exporter can write it through
 * unchanged.
 */
export interface BlurFilter extends FilterBase {
  kind: 'blur';
  radius: number;
}

/** Unsharp mask. `amount` is a percentage; 100 is a firm sharpen. */
export interface SharpenFilter extends FilterBase {
  kind: 'sharpen';
  amount: number;
}

/** Square blocks, `size` pixels on a side. */
export interface PixelateFilter extends FilterBase {
  kind: 'pixelate';
  size: number;
}

export interface DropShadowFilter extends FilterBase {
  kind: 'drop-shadow';
  dx: number;
  dy: number;
  blur: number;
  color: string;
  opacity: number;
}

/** A shadow with no offset, drawn in a colour of its own. */
export interface GlowFilter extends FilterBase {
  kind: 'glow';
  radius: number;
  color: string;
  strength: number;
}

/**
 * Added grain. `monochrome` shifts all three channels together, which is film
 * grain; the alternative shifts them independently, which is sensor noise.
 */
export interface NoiseFilter extends FilterBase {
  kind: 'noise';
  amount: number;
  monochrome: boolean;
}

export type FilterSpec =
  | BlurFilter
  | SharpenFilter
  | PixelateFilter
  | DropShadowFilter
  | GlowFilter
  | NoiseFilter;

export const FILTER_KINDS: readonly FilterKind[] = [
  'blur', 'sharpen', 'pixelate', 'drop-shadow', 'glow', 'noise',
];

export const FILTER_LABELS: Record<FilterKind, string> = {
  'blur': 'Blur',
  'sharpen': 'Sharpen',
  'pixelate': 'Pixelate',
  'drop-shadow': 'Drop shadow',
  'glow': 'Glow',
  'noise': 'Noise',
};

export function createFilter(kind: FilterKind): FilterSpec {
  const base = { id: newId(), enabled: true };
  switch (kind) {
    case 'blur':
      return { ...base, kind, radius: 6 };
    case 'sharpen':
      return { ...base, kind, amount: 60 };
    case 'pixelate':
      return { ...base, kind, size: 8 };
    case 'drop-shadow':
      return { ...base, kind, dx: 4, dy: 6, blur: 8, color: '#000000', opacity: 0.45 };
    case 'glow':
      return { ...base, kind, radius: 10, color: '#ffd166', strength: 1 };
    case 'noise':
      return { ...base, kind, amount: 12, monochrome: true };
  }
}

/**
 * The limits every reader and every slider agrees on.
 *
 * A radius is a cost as well as a look — a blur is three passes over the
 * surface per axis — so the ceiling is what keeps a hand-edited document from
 * hanging the tab, not a judgement about taste.
 */
export const FILTER_LIMITS = {
  radius: { min: 0, max: 200 },
  amount: { min: 0, max: 300 },
  pixelSize: { min: 2, max: 200 },
  offset: { min: -400, max: 400 },
  opacity: { min: 0, max: 1 },
  strength: { min: 0, max: 4 },
  noise: { min: 0, max: 100 },
} as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A filter with every number inside its limits. Applied on parse and on edit. */
export function clampFilter(filter: FilterSpec): FilterSpec {
  const L = FILTER_LIMITS;
  switch (filter.kind) {
    case 'blur':
      return { ...filter, radius: clamp(filter.radius, L.radius.min, L.radius.max) };
    case 'sharpen':
      return { ...filter, amount: clamp(filter.amount, L.amount.min, L.amount.max) };
    case 'pixelate':
      return { ...filter, size: Math.round(clamp(filter.size, L.pixelSize.min, L.pixelSize.max)) };
    case 'drop-shadow':
      return {
        ...filter,
        dx: clamp(filter.dx, L.offset.min, L.offset.max),
        dy: clamp(filter.dy, L.offset.min, L.offset.max),
        blur: clamp(filter.blur, L.radius.min, L.radius.max),
        opacity: clamp(filter.opacity, L.opacity.min, L.opacity.max),
      };
    case 'glow':
      return {
        ...filter,
        radius: clamp(filter.radius, L.radius.min, L.radius.max),
        strength: clamp(filter.strength, L.strength.min, L.strength.max),
      };
    case 'noise':
      return { ...filter, amount: clamp(filter.amount, L.noise.min, L.noise.max) };
  }
}

/**
 * Whether a filter would visibly do anything.
 *
 * A disabled filter and a zero-radius blur cost the same to skip and the same
 * to apply — a full read-back and write-back of the surface — so the check is
 * worth making before the buffer is allocated rather than after.
 */
export function isActiveFilter(filter: FilterSpec): boolean {
  if (!filter.enabled) return false;
  switch (filter.kind) {
    case 'blur': return filter.radius > 0;
    case 'sharpen': return filter.amount > 0;
    case 'pixelate': return filter.size > 1;
    case 'drop-shadow': return filter.opacity > 0 && (filter.dx !== 0 || filter.dy !== 0 || filter.blur > 0);
    case 'glow': return filter.strength > 0 && filter.radius > 0;
    case 'noise': return filter.amount > 0;
  }
}

export function hasActiveFilters(filters: readonly FilterSpec[] | undefined): boolean {
  return Boolean(filters?.some(isActiveFilter));
}

/** A one-line summary for the inspector row. */
export function describeFilter(filter: FilterSpec): string {
  switch (filter.kind) {
    case 'blur': return `${Math.round(filter.radius)} px`;
    case 'sharpen': return `${Math.round(filter.amount)}%`;
    case 'pixelate': return `${Math.round(filter.size)} px blocks`;
    case 'drop-shadow': return `${Math.round(filter.dx)}, ${Math.round(filter.dy)} · ${Math.round(filter.blur)} px`;
    case 'glow': return `${Math.round(filter.radius)} px`;
    case 'noise': return `${Math.round(filter.amount)}%${filter.monochrome ? ' mono' : ''}`;
  }
}
