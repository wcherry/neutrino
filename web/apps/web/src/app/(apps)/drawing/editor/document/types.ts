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

/** A freehand or plotted path. `points` are canvas coordinates. */
export interface PathObject extends VectorObjectBase {
  kind: 'path';
  points: Point[];
  closed: boolean;
}

export type VectorObject = RectObject | EllipseObject | LineObject | PathObject;

export type VectorObjectKind = VectorObject['kind'];

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
}

export interface VectorLayerNode extends NodeBase {
  type: 'vector';
  objects: VectorObject[];
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
}

export type DrawingNode = StackNode | RasterLayerNode | VectorLayerNode | TextLayerNode;

export type NodeType = DrawingNode['type'];

/** A node that holds other nodes. */
export function isStack(node: DrawingNode): node is StackNode {
  return node.type === 'stack';
}

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

/**
 * sRGB is the baseline and the only profile this phase writes. `iccUri` is
 * where an embedded profile lands in phase 7; until then a document that names
 * anything else is still readable, it just renders as sRGB.
 */
export interface ColorProfile {
  name: string;
  iccUri?: string;
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
}

export const DOCUMENT_VERSION = 2 as const;
