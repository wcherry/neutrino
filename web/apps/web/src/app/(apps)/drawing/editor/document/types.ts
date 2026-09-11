/**
 * The drawing document model.
 *
 * A drawing is a **tree**, not a list. The old model was a flat `Shape[]` with
 * a `layerId` string pointing at a flat `Layer[]`, which could express exactly
 * one thing — one level of grouping, of one kind of content — and could not
 * express a group inside a group, a layer of pixels, a mask, a blend mode or an
 * opacity below the object level. This model is the tree the redesign
 * (`agent_docs/drawing_app_redesign.md`) is built on and the shape the
 * OpenRaster writer serialises.
 *
 * Two conventions run through the whole file and are worth reading before
 * anything else:
 *
 * **`children[0]` is the topmost layer.** That is OpenRaster's own rule for
 * `<stack>` and adopting it here means the writer never reverses anything and
 * the layers panel lists `children` in the order it draws them. The *renderer*
 * is the one that iterates backwards. The old model's "the background is
 * whichever layer is last, or the one flagged `isBackground`" convention is
 * gone: the background is a property of the canvas, not a layer.
 *
 * **The canvas has a size.** OpenRaster's `<image>` requires `w` and `h`, and
 * a document with no bounds has no honest answer for them, no anchor for a
 * guide or a grid origin, and no fixed frame for a layer offset. So a drawing
 * is a fixed-size page you pan and zoom around, as it is in Krita, GIMP and
 * Photoshop, rather than the unbounded plane the first version drew on.
 */

import type { AdjustmentSpec } from './adjustments';
import type { LinkedAsset } from './assets';
import type { ColorProfile } from './color';
import type { FilterSpec } from './filters';
import type { WorkspaceState } from './workspace';

// The four modules above own a slice of the model each, because each is a body
// of arithmetic (colour operations, pixel effects, unit conversion, hashing)
// that has to be testable on its own. They are re-exported here so the document
// model still has one import path.
export type { AdjustmentSpec, LinkedAsset, ColorProfile, FilterSpec, WorkspaceState };

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An affine transform, in the same six-number order as SVG's `matrix(a b c d e f)`
 * and `DOMMatrix`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 *
 * Every node carries one. For vector and text content it is the whole story.
 * For a raster layer it is *also* baked into the pixels on export — an
 * OpenRaster reader has nowhere to put a matrix — while the matrix itself stays
 * here so reopening the file in Neutrino gets the editable version back
 * (redesign §4, "Transforms and reusable objects").
 */
export interface Transform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

/**
 * The fifteen modes the redesign lists (§2, "Blend modes").
 *
 * The names are the CSS/canvas `globalCompositeOperation` spellings rather than
 * a private vocabulary, because that is the one place they have to be exactly
 * right — the renderer assigns them straight through. `io/ora/compositeOp.ts`
 * maps them to OpenRaster's `svg:` names, and `composite-op` is the only place
 * the other spelling appears.
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'hue', 'saturation', 'color', 'luminosity',
];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  'normal': 'Normal',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'overlay': 'Overlay',
  'darken': 'Darken',
  'lighten': 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  'difference': 'Difference',
  'hue': 'Hue',
  'saturation': 'Saturation',
  'color': 'Color',
  'luminosity': 'Luminosity',
};

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

/**
 * A block of pixels, as a PNG data URL plus where it sits on the canvas.
 *
 * A data URL and not a Drive reference: a drawing's body is one encrypted blob,
 * and a raster layer pointing at a second file would be a second thing to
 * encrypt, keep in step and lose. It is also exactly what the OpenRaster writer
 * needs — `data/layer-<id>.png` is these bytes, and `x`/`y` are the `<layer>`
 * offsets — so the mapping out is a decode rather than a render.
 */
export interface RasterSource {
  /** PNG bytes as a `data:image/png;base64,…` URL. */
  dataUrl: string;
  width: number;
  height: number;
  /** Offset of the top-left pixel within the canvas. */
  x: number;
  y: number;
  /**
   * Bits per channel the asset arrived with, where it is known.
   *
   * Recorded rather than honoured: a canvas is eight bits per channel, so these
   * pixels are eight-bit whatever the source was. Keeping the number means a
   * 16-bit import is *known* to have lost depth instead of losing it silently —
   * see `document/color.ts`.
   */
  bitDepth?: 8 | 16;
}

/**
 * A mask attached to a node.
 *
 * OpenRaster has no baseline mask model, so this is a Neutrino extension with a
 * rendered fallback: the mask is a grayscale PNG in `data/`, the relationship
 * is a `maskFor` entry in `META-INF/neutrino/document.json`, and the layer PNG
 * beside it is written with the mask *already applied* to its alpha, so a
 * reader that ignores every extension still sees the right picture (redesign
 * §3, "Masks").
 *
 * `kind` is what the mask means rather than how it is stored — all four are the
 * same grayscale channel, and only `clipping` reads its shape from the layer
 * below instead of from `source`.
 */
export interface LayerMask {
  id: string;
  kind: 'layer' | 'clipping' | 'transparency' | 'group';
  /** The grayscale channel. Absent for a `clipping` mask, which has none. */
  source: RasterSource | null;
  enabled: boolean;
  /** Black hides and white shows; inverted swaps them. */
  inverted: boolean;
}

// ---------------------------------------------------------------------------
// Vector content
// ---------------------------------------------------------------------------

export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'long-dash';

export interface VectorStyle {
  /** A CSS colour, a `linear-gradient(…)`/`radial-gradient(…)`, `url(…)`, or `none`. */
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
}

export interface VectorObjectBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Degrees, clockwise, about the centre of `frame`. */
  rotation: number;
  /** Axis-aligned extent before `rotation`, in canvas coordinates. */
  frame: Rect;
  style: VectorStyle;
}

export interface RectObject extends VectorObjectBase {
  kind: 'rect';
  cornerRadius: number;
}

export interface EllipseObject extends VectorObjectBase {
  kind: 'ellipse';
}

/**
 * A straight segment from the frame's origin to its opposite corner.
 *
 * `frame.width`/`frame.height` are signed here — that is what lets one rect
 * describe all four directions a line can point — so anything reading a line's
 * extent must normalise rather than assume a positive size.
 */
export interface LineObject extends VectorObjectBase {
  kind: 'line';
  arrowStart: boolean;
  arrowEnd: boolean;
}

/**
 * A point on a path, with optional cubic handles.
 *
 * `in` and `out` are **absolute** canvas coordinates, not offsets from the
 * anchor. That is what makes every existing transform correct by construction:
 * translating, scaling and rotating a path maps handles with exactly the same
 * arithmetic as anchors, and a handle stored as an offset would need its own
 * (easily forgotten) case in each of them.
 *
 * A point with neither handle is a corner, and a path of nothing but corners is
 * the polyline the freehand pen has always drawn — which is why `PathPoint`
 * extends `Point` rather than replacing it. Every `{x, y}` already stored parses
 * and renders unchanged.
 */
export interface PathPoint extends Point {
  /** Control point governing the curve *arriving* at this anchor. */
  in?: Point;
  /** Control point governing the curve *leaving* this anchor. */
  out?: Point;
}

/** One contour of a path. */
export interface SubPath {
  points: PathPoint[];
  closed: boolean;
}

/**
 * A freehand, plotted or imported path. `points` are canvas coordinates.
 *
 * `points`/`closed` are the first contour and `subpaths` holds any further
 * ones. The split is deliberately lopsided rather than a uniform
 * `contours: SubPath[]`: almost every path in a drawing has exactly one
 * contour, every path written before this had exactly one, and a single field
 * would have meant migrating all of them to say so. A second contour appears
 * only where something produced one — an imported SVG `<path>` with a hole, or
 * a glyph outline — and `fillRule` is what makes that hole a hole.
 */
export interface PathObject extends VectorObjectBase {
  kind: 'path';
  points: PathPoint[];
  closed: boolean;
  /** Contours beyond the first. Absent for the ordinary single-contour path. */
  subpaths?: SubPath[];
  /** How overlapping contours combine. SVG's own two rules, and its default. */
  fillRule?: 'nonzero' | 'evenodd';
}

export type VectorObject = RectObject | EllipseObject | LineObject | PathObject;

export type VectorObjectKind = VectorObject['kind'];

/** Every contour of a path, first one included. */
export function pathContours(object: PathObject): SubPath[] {
  return [{ points: object.points, closed: object.closed }, ...(object.subpaths ?? [])];
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * What every object in the tree carries, per redesign §1.
 *
 * `parentId` is redundant against `children` and is kept anyway because the
 * spec asks for it and because the flat lookups (`findNode`, the layers panel's
 * drag targets) are much simpler with it. It is not hand-maintained: the tree
 * helpers set it on every insert and move, and `normalizeTree` rebuilds it on
 * load, so `children` stays the single source of truth and `parentId` is a
 * derived index that cannot drift across a save.
 *
 * `bounds` is cached derived state on the same terms — recomputed by
 * `refreshBounds`, which every content edit and `parseDocument` run through.
 */
export interface NodeBase {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  /** 0–1. */
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  transform: Transform2D;
  /** Content extent in canvas coordinates, before `transform`. */
  bounds: Rect;
  createdAt: string;
  modifiedAt: string;
  mask?: LayerMask;
  /**
   * Non-destructive effects over this node's own pixels, applied first to last
   * (redesign §4, "Filters and effects").
   *
   * On `NodeBase` rather than on the layer types, so a *group* can carry one:
   * blurring twelve layers as a unit is a different picture from blurring each
   * of them, and the group is the only place that difference can be expressed.
   */
  filters?: FilterSpec[];
}

/** A group. Serialises to a nested `<stack>`. */
export interface StackNode extends NodeBase {
  type: 'stack';
  /**
   * OpenRaster's `isolation`. `isolate` composites the group's children against
   * transparency and blends the result as one; `auto` lets each child blend
   * with whatever is under the group.
   */
  isolation: 'isolate' | 'auto';
  children: DrawingNode[];
}

export interface RasterLayerNode extends NodeBase {
  type: 'raster';
  source: RasterSource;
  /**
   * The `LinkedAsset` these pixels were imported from, where they were imported
   * at all — a layer painted from scratch has none. The asset is provenance
   * only; `source` is always the pixels, so a missing or stale asset costs the
   * layer nothing (`document/assets.ts`).
   */
  assetId?: string;
}

export interface VectorLayerNode extends NodeBase {
  type: 'vector';
  objects: VectorObject[];
}

/**
 * Text laid out along a path instead of along a box.
 *
 * The path is **referenced, not owned**: `pathId` names a `PathObject` that
 * already exists in some vector layer, and that object stays independently
 * selectable, editable, visible or hidden on its own terms — reshape it and the
 * text re-flows. This is exactly what SVG's `<textPath href="#id">` expresses,
 * so the vector half of an export needs no extension for it
 * (`agent_docs/drawing_app_redesign.md` §4, "Text on a path").
 *
 * It is deliberately *not* a private geometry field on the text layer. An
 * earlier version of this app had that — a text shape carrying one or two
 * hand-placed cubics and a mode that stretched glyphs between them — and the
 * curve was unreachable by every other tool and had no SVG equivalent to export
 * to.
 */
export interface TextPathBinding {
  /** The `PathObject` to lay the text along. */
  pathId: string;
  /** Where the text starts, as a percentage of the path's length. */
  startOffset: number;
  /** How the text sits against `startOffset`. */
  align: 'start' | 'middle' | 'end';
  /** Baseline shift away from the path, in pixels. Positive is outward. */
  baselineOffset: number;
  /** SVG's `side`: which flank of the path the text runs along. */
  side: 'left' | 'right';
}

export interface TextLayerNode extends NodeBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  /** Multiple of `fontSize`. */
  lineHeight: number;
  color: string;
  /** Where the text is laid out. Its width drives wrapping and alignment. */
  box: Rect;
  /** Set to lay the text along a path rather than inside `box`. */
  textPath?: TextPathBinding;
}

/**
 * A placed copy of a symbol.
 *
 * The content lives once in `DrawingDocument.symbols` and every instance is a
 * reference plus a transform, which is the "stored once and referenced by UUID"
 * redesign §4 asks for. Editing the symbol updates every instance; nothing is
 * copied until the user explicitly detaches one.
 *
 * Both exports carry a rendered fallback, as every Neutrino-only feature must:
 * SVG writes `<use href="#…">` against a real `<symbol>`, and OpenRaster — which
 * has no notion of reuse — gets the instance rasterised like any other layer.
 */
export interface InstanceNode extends NodeBase {
  type: 'instance';
  symbolId: string;
}

/** Reusable content, stored once and referenced by `InstanceNode.symbolId`. */
export interface SymbolDefinition {
  id: string;
  name: string;
  /**
   * The content, as a detached subtree. Its own transform is neutral — an
   * instance's transform is the only one that positions it, so a symbol
   * carrying a translation would offset every instance by it twice.
   */
  content: DrawingNode;
  createdAt: string;
}

/**
 * A colour change applied to everything below it, without touching any of it.
 *
 * The layer carries parameters and no pixels — that is what makes it
 * non-destructive — and it acts on **the layers below it within its own
 * stack**, stopping at the group boundary. Photoshop's "pass through" reaches
 * out of the group as well; this does not, deliberately, because a group is
 * then the thing that bounds an adjustment and there is nowhere else to put
 * that control. A group with an adjustment in it is a correction to those
 * layers, and moving one out of the group is how you widen its reach.
 *
 * Three fields it shares with every other node earn their keep here rather than
 * being inert: **`opacity`** is the strength of the correction, **`mask`**
 * confines it to part of the canvas (a `clipping` mask confines it to the alpha
 * of the layer below, which is the usual way to correct one layer without
 * correcting its neighbours), and **`visible`** turns it off without deleting
 * it. `blendMode` has no meaning for a layer that produces no pixels and is
 * ignored.
 *
 * The canvas background is not layer content and is not adjusted; a correction
 * applies to what has been *drawn*.
 */
export interface AdjustmentLayerNode extends NodeBase {
  type: 'adjustment';
  adjustment: AdjustmentSpec;
}

export type DrawingNode =
  | StackNode
  | RasterLayerNode
  | VectorLayerNode
  | TextLayerNode
  | InstanceNode
  | AdjustmentLayerNode;

export type NodeType = DrawingNode['type'];

/** A node that holds other nodes. */
export function isStack(node: DrawingNode): node is StackNode {
  return node.type === 'stack';
}

/** A node that carries pixels a brush can paint into. */
export function isRaster(node: DrawingNode): node is RasterLayerNode {
  return node.type === 'raster';
}

/** A node that corrects what is under it rather than drawing anything itself. */
export function isAdjustment(node: DrawingNode): node is AdjustmentLayerNode {
  return node.type === 'adjustment';
}

// ---------------------------------------------------------------------------
// Pixel selection
// ---------------------------------------------------------------------------

/**
 * The active selection — the region editing is confined to.
 *
 * Redesign §3 asks for selections to be stored as grayscale PNG masks, and
 * `mask` is that. The other three kinds are not a shortcut around it but the
 * honest description of what the user actually made: a rectangular marquee is a
 * rectangle, and rasterising one into a PNG on every drag would cost a
 * full-canvas encode per mouse move to store, less precisely, what four numbers
 * already say. Anything that consumes a selection goes through
 * `selectionToMask`, so the general case and the cheap ones behave identically;
 * `mask` is what a flood-fill, a feather or an imported `.ora` produces, and
 * what all four become on the way into a package.
 */
export type SelectionShape =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ellipse'; rect: Rect }
  | { kind: 'lasso'; points: Point[] }
  | { kind: 'mask'; source: RasterSource };

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface CanvasSettings {
  width: number;
  height: number;
  /** Pixels per inch, written as OpenRaster's `xres`/`yres`. */
  dpi: number;
  /**
   * Painted under every layer. `null` is a transparent document — which is a
   * real choice and not the same as white, and is why this is nullable rather
   * than defaulting to `#ffffff`.
   */
  background: string | null;
}

export interface Guide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  /** Distance from the canvas origin along the axis the guide crosses. */
  position: number;
}

export interface GridSettings {
  visible: boolean;
  size: number;
  origin: Point;
  snap: boolean;
  subdivisions: number;
}

export interface DocumentMetadata {
  title: string;
  author?: string;
  description?: string;
  createdAt: string;
  modifiedAt: string;
  application: { name: string; version: string };
}

/** The editor's viewport, saved so reopening a drawing lands where it was left. */
export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface DrawingDocument {
  /**
   * 2 is this model. 1 was the flat `{ shapes, layers }` body that predated it
   * and that nothing ever stored a file in, so there is no migration and no
   * reader for it — a body that is not version 2 opens as a new document.
   *
   * It stays 2 across phases 3–8. Everything those added — cubic path handles,
   * text on a path, symbols, the active selection, filters, linked assets, the
   * workspace block — is a new optional field or a widening of one that already
   * existed, so a version 2 body written before them parses under this reader
   * with no migration and a body written by this build opens in the earlier one
   * with the new features dropped rather than the file refused. Bumping the
   * number would have bought nothing and cost every drawing already saved.
   *
   * The **adjustment layer** is the one addition that is a new node *type* and
   * is worth being explicit about: an older build's `parseDocument` drops a node
   * it does not recognise, so an adjustment opens there as a missing layer
   * rather than as a broken file — the picture loses a correction and keeps
   * everything else, which is the same trade every optional field makes.
   */
  version: 2;
  canvas: CanvasSettings;
  /** The root `<stack>`. Its own transform, opacity and blend are always neutral. */
  root: StackNode;
  guides: Guide[];
  grid: GridSettings;
  colorProfile: ColorProfile;
  metadata: DocumentMetadata;
  viewport?: ViewportState;
  /** Reusable content, referenced by `InstanceNode.symbolId`. */
  symbols?: SymbolDefinition[];
  /** The active pixel selection, or absent for "everything". */
  selection?: SelectionShape;
  /** Provenance for imported pixels, referenced by `RasterLayerNode.assetId`. */
  assets?: LinkedAsset[];
  /**
   * Rulers, units, snapping, canvas rotation and what was open — editor state
   * rather than image content, which is why a reader that ignores it loses
   * nothing about the picture (redesign §5).
   */
  workspace?: WorkspaceState;
}

export const DOCUMENT_VERSION = 2 as const;
