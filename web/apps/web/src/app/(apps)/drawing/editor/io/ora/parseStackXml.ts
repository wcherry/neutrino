/**
 * Reading `stack.xml`.
 *
 * The counterpart to `stackXml.ts`, and deliberately much more forgiving than
 * it: this file was written by Krita, GIMP, MyPaint, Drawpile or something
 * nobody here has heard of, and the OpenRaster baseline leaves most attributes
 * optional. So every attribute has a default, an element this build does not
 * recognise is skipped rather than fatal, and the only thing that can fail the
 * parse outright is markup that is not XML or has no `<image>` at all.
 *
 * **Unknown extensions are ignored, not preserved.** OpenRaster's extension
 * mechanism is bare attributes on `<layer>` and `<stack>` — there is no
 * namespace to isolate them and no way to tell an extension apart from a
 * typo — so round-tripping them would mean carrying arbitrary foreign strings
 * through the model and re-emitting them on save, where a stale one would
 * describe the file wrongly. A Neutrino-written file loses nothing to this
 * because its own state travels in `META-INF/neutrino/document.json`; a foreign
 * one loses whatever that application put outside the baseline, which is the
 * trade the baseline exists to make.
 *
 * This module is pure text in, plain objects out. Turning those objects into a
 * document — which needs the archive's PNGs — is `readOra.ts`.
 */

import { fromCompositeOp } from './compositeOp';
import type { BlendMode } from '../../document/types';

/** What `<image>` says about the drawing as a whole. */
export interface ParsedImage {
  width: number;
  height: number;
  /** Pixels per inch. OpenRaster's `xres`/`yres`; 72 when absent, per the spec. */
  dpi: number;
  name: string;
  version: string;
  root: ParsedStack;
}

export interface ParsedCommon {
  name: string;
  opacity: number;
  visible: boolean;
  blendMode: BlendMode;
  /** The `edit-locked` extension. */
  locked: boolean;
  /** The `selected` extension. At most one node in a file should carry it. */
  selected: boolean;
}

export interface ParsedStack extends ParsedCommon {
  type: 'stack';
  isolation: 'isolate' | 'auto';
  children: ParsedNode[];
}

export interface ParsedLayer extends ParsedCommon {
  type: 'layer';
  /** Archive path of the layer's raster asset. */
  src: string;
  x: number;
  y: number;
}

export type ParsedNode = ParsedStack | ParsedLayer;

/** OpenRaster's own default resolution when `xres`/`yres` are absent. */
export const DEFAULT_ORA_DPI = 72;

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

function attrNumber(element: Element, name: string, fallback: number): number {
  const raw = element.getAttribute(name);
  if (raw === null) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseCommon(element: Element): ParsedCommon {
  return {
    name: element.getAttribute('name') ?? '',
    // Clamped rather than defaulted on a bad value: an opacity of "110%" means
    // "fully opaque" far more often than it means "somebody meant 1".
    opacity: Math.min(1, Math.max(0, attrNumber(element, 'opacity', 1))),
    // Anything other than the literal "hidden" is visible. The spec's values
    // are `visible` and `hidden`, and files in the wild also write "1"/"0" and
    // omit it entirely — all of which should show the layer.
    visible: element.getAttribute('visibility') !== 'hidden',
    blendMode: fromCompositeOp(element.getAttribute('composite-op') ?? ''),
    locked: element.getAttribute('edit-locked') === 'true',
    selected: element.getAttribute('selected') === 'true',
  };
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function parseStack(element: Element): ParsedStack {
  return {
    ...parseCommon(element),
    type: 'stack',
    isolation: element.getAttribute('isolation') === 'isolate' ? 'isolate' : 'auto',
    children: parseChildren(element),
  };
}

function parseLayer(element: Element): ParsedLayer | null {
  const src = element.getAttribute('src');
  // A `<layer>` with no `src` names no pixels. There is nothing to load and
  // nothing to show, so it is dropped rather than becoming an empty row.
  if (!src) return null;
  return {
    ...parseCommon(element),
    type: 'layer',
    src,
    x: Math.round(attrNumber(element, 'x', 0)),
    y: Math.round(attrNumber(element, 'y', 0)),
  };
}

function parseChildren(parent: Element): ParsedNode[] {
  const out: ParsedNode[] = [];
  for (const child of Array.from(parent.children)) {
    // `localName` rather than `tagName` so a namespaced writer's `ora:layer`
    // is still a layer.
    switch (child.localName) {
      case 'stack':
        out.push(parseStack(child));
        break;
      case 'layer': {
        const layer = parseLayer(child);
        if (layer) out.push(layer);
        break;
      }
      // Everything else — a `<filters>` proposal element, an application's own
      // annotation — is skipped. Its children are not walked: an unrecognised
      // wrapper says nothing about what its contents mean here.
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * `stack.xml` as plain objects, or null when it is not an OpenRaster stack.
 *
 * `DOMParser` reports a malformed document by *returning* a `<parsererror>`
 * element rather than throwing, which is why that is checked explicitly — the
 * alternative is a silently empty drawing from a corrupt file.
 */
export function parseStackXml(xml: string): ParsedImage | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const image = doc.documentElement;
  if (!image || image.localName !== 'image') return null;

  const width = Math.round(attrNumber(image, 'w', 0));
  const height = Math.round(attrNumber(image, 'h', 0));
  if (width <= 0 || height <= 0) return null;

  // The spec has one `<stack>` directly under `<image>`. A file with none is
  // still a valid canvas with nothing on it, which is better opened empty than
  // refused.
  const rootElement = Array.from(image.children).find((child) => child.localName === 'stack');
  const root: ParsedStack = rootElement
    ? parseStack(rootElement)
    : { name: '', opacity: 1, visible: true, blendMode: 'normal', locked: false, selected: false, type: 'stack', isolation: 'auto', children: [] };

  // `xres`/`yres` can differ. The model carries one DPI, so the horizontal one
  // wins and the difference is dropped rather than averaged into a number
  // neither axis agreed on.
  const dpi = Math.round(attrNumber(image, 'xres', DEFAULT_ORA_DPI));

  return {
    width,
    height,
    dpi: dpi > 0 ? dpi : DEFAULT_ORA_DPI,
    name: image.getAttribute('name') ?? '',
    version: image.getAttribute('version') ?? '',
    root,
  };
}
