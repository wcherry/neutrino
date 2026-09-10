/**
 * Blend modes ↔ OpenRaster `composite-op`.
 *
 * OpenRaster names its operators after SVG compositing (`svg:src-over`,
 * `svg:multiply`, …) and the model names them after CSS and canvas
 * (`normal`, `multiply`, …). The two lists are otherwise the same fifteen
 * modes, and this is the only file where the other spelling appears — the
 * renderer assigns the model's names straight to `globalCompositeOperation`,
 * and everything else stays in the model's vocabulary.
 *
 * The mapping is a table rather than a string transform because exactly one
 * entry is irregular: `normal` is `svg:src-over`, not `svg:normal`. A
 * find-and-replace would look right and produce a file no OpenRaster reader
 * composites correctly.
 */

import type { BlendMode } from '../../document/types';

const TO_COMPOSITE_OP: Record<BlendMode, string> = {
  'normal': 'svg:src-over',
  'multiply': 'svg:multiply',
  'screen': 'svg:screen',
  'overlay': 'svg:overlay',
  'darken': 'svg:darken',
  'lighten': 'svg:lighten',
  'color-dodge': 'svg:color-dodge',
  'color-burn': 'svg:color-burn',
  'hard-light': 'svg:hard-light',
  'soft-light': 'svg:soft-light',
  'difference': 'svg:difference',
  'hue': 'svg:hue',
  'saturation': 'svg:saturation',
  'color': 'svg:color',
  'luminosity': 'svg:luminosity',
};

const FROM_COMPOSITE_OP = new Map<string, BlendMode>(
  (Object.entries(TO_COMPOSITE_OP) as [BlendMode, string][]).map(([mode, op]) => [op, mode]),
);

export function toCompositeOp(mode: BlendMode): string {
  return TO_COMPOSITE_OP[mode] ?? 'svg:src-over';
}

/**
 * The blend mode for a `composite-op`, or `normal` for one this build does not
 * implement.
 *
 * OpenRaster allows operators with no CSS equivalent — `svg:plus`,
 * `svg:dst-in`, `svg:src-atop` and the rest of the Porter-Duff set. Reading one
 * as `normal` shows the layer in the right place with the wrong compositing,
 * which is the better of the two failures: the alternative is to drop the layer.
 *
 * Unused until the reader lands in phase 3, and written now because a mapping
 * table with only one direction is how the two halves drift apart.
 */
export function fromCompositeOp(op: string): BlendMode {
  return FROM_COMPOSITE_OP.get(op.trim()) ?? 'normal';
}
