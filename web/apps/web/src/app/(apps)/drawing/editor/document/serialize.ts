/**
 * The document as stored bytes.
 *
 * A drawing's body is this JSON, encrypted, under
 * `application/x-neutrino-drawing`. The `.ora` package is a second, portable
 * representation written by `io/ora` — it is not what Drive holds, because
 * until the OpenRaster *reader* lands (redesign phase 3) a stored `.ora` would
 * be a file this app could write and not open.
 *
 * Parsing is defensive in one direction only. Every field is coerced to
 * something the renderer can draw — a missing blend mode reads as `normal`, a
 * nonsense opacity clamps — because the body has been through a network, a
 * cipher and possibly a hand edit, and a single bad number should not cost the
 * whole drawing. What it will *not* do is guess at another format: a body that
 * is not version 2 produces a new empty document rather than an attempted
 * conversion.
 */

import { newId } from './ids';
import {
  APPLICATION_NAME,
  APPLICATION_VERSION,
  DEFAULT_CANVAS,
  DEFAULT_GRID,
  DEFAULT_VECTOR_STYLE,
  createDocument,
} from './factory';
import { normalizeTree, refreshBounds, symbolTable } from './tree';
import { ADJUSTMENT_KINDS, createAdjustment, type AdjustmentKind, type AdjustmentSpec } from './adjustments';
import { isReloadableUri, type LinkedAsset } from './assets';
import {
  DEFAULT_HDR,
  isColorSpaceName,
  type ColorProfile,
  type HdrSettings,
} from './color';
import { FILTER_KINDS, clampFilter, createFilter, type FilterKind, type FilterSpec } from './filters';
import {
  DEFAULT_SNAP,
  DEFAULT_WORKSPACE,
  isRulerUnit,
  type SnapSettings,
  type WorkspaceState,
} from './workspace';
import {
  BLEND_MODES,
  DOCUMENT_VERSION,
  IDENTITY,
  type BlendMode,
  type CanvasSettings,
  type DrawingDocument,
  type DrawingNode,
  type Guide,
  type LayerMask,
  type NodeBase,
  type PathPoint,
  type Point,
  type RasterSource,
  type Rect,
  type SelectionShape,
  type StackNode,
  type StrokeStyle,
  type SubPath,
  type SymbolDefinition,
  type TextPathBinding,
  type Transform2D,
  type VectorObject,
  type VectorStyle,
} from './types';

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamped(v: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num(v, fallback)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function isoDate(v: unknown, fallback: string): string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback;
}

function blendMode(v: unknown): BlendMode {
  return typeof v === 'string' && (BLEND_MODES as readonly string[]).includes(v)
    ? (v as BlendMode)
    : 'normal';
}

function rect(v: unknown, fallback: Rect): Rect {
  if (!isRecord(v)) return { ...fallback };
  return {
    x: num(v.x, fallback.x),
    y: num(v.y, fallback.y),
    width: num(v.width, fallback.width),
    height: num(v.height, fallback.height),
  };
}

function point(v: unknown, fallback: Point): Point {
  if (!isRecord(v)) return { ...fallback };
  return { x: num(v.x, fallback.x), y: num(v.y, fallback.y) };
}

function transform(v: unknown): Transform2D {
  if (!isRecord(v)) return { ...IDENTITY };
  return {
    a: num(v.a, IDENTITY.a),
    b: num(v.b, IDENTITY.b),
    c: num(v.c, IDENTITY.c),
    d: num(v.d, IDENTITY.d),
    e: num(v.e, IDENTITY.e),
    f: num(v.f, IDENTITY.f),
  };
}

/**
 * A stored raster block.
 *
 * A source whose `dataUrl` is not a PNG data URL is dropped rather than kept:
 * it would reach an `<img>` as an arbitrary URL, and a document is not a place
 * from which to fetch things. Returning null makes the layer fall back to
 * nothing drawn, which is visible and harmless.
 */
function rasterSource(v: unknown): RasterSource | null {
  if (!isRecord(v)) return null;
  const dataUrl = str(v.dataUrl, '');
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) return null;
  return {
    dataUrl,
    width: Math.max(1, Math.round(num(v.width, 1))),
    height: Math.max(1, Math.round(num(v.height, 1))),
    x: num(v.x, 0),
    y: num(v.y, 0),
    ...(v.bitDepth === 16 ? { bitDepth: 16 as const } : {}),
  };
}

function mask(v: unknown): LayerMask | undefined {
  if (!isRecord(v)) return undefined;
  const kind = str(v.kind, 'layer');
  const known: LayerMask['kind'][] = ['layer', 'clipping', 'transparency', 'group'];
  return {
    id: str(v.id, newId()),
    kind: (known as string[]).includes(kind) ? (kind as LayerMask['kind']) : 'layer',
    source: rasterSource(v.source),
    enabled: bool(v.enabled, true),
    inverted: bool(v.inverted, false),
  };
}

/**
 * A stored adjustment.
 *
 * Every field is read *over* the identity default for its kind, so a spec
 * written by a build that had one more slider parses here with that slider
 * neutral rather than at zero — which for a gamma or a white point is the
 * difference between "unchanged" and "the picture is black".
 */
function adjustment(v: unknown): AdjustmentSpec {
  const kind = isRecord(v) ? str(v.kind, '') : '';
  const known = (ADJUSTMENT_KINDS as readonly string[]).includes(kind)
    ? (kind as AdjustmentKind)
    : 'brightness-contrast';
  const base = createAdjustment(known);
  if (!isRecord(v)) return base;

  switch (base.kind) {
    case 'brightness-contrast':
      return {
        ...base,
        brightness: clamped(v.brightness, base.brightness, -100, 100),
        contrast: clamped(v.contrast, base.contrast, -100, 100),
      };
    case 'levels':
      return {
        ...base,
        inputBlack: clamped(v.inputBlack, base.inputBlack, 0, 255),
        inputWhite: clamped(v.inputWhite, base.inputWhite, 0, 255),
        gamma: clamped(v.gamma, base.gamma, 0.01, 10),
        outputBlack: clamped(v.outputBlack, base.outputBlack, 0, 255),
        outputWhite: clamped(v.outputWhite, base.outputWhite, 0, 255),
      };
    case 'curves': {
      const points = Array.isArray(v.points)
        ? v.points.filter(isRecord).map((p) => ({
            x: clamped(p.x, 0, 0, 255),
            y: clamped(p.y, 0, 0, 255),
          }))
        : [];
      const channel = v.channel === 'r' || v.channel === 'g' || v.channel === 'b' ? v.channel : 'rgb';
      // Fewer than two handles is not a curve; falling back to the identity
      // pair keeps the editor's drag handles somewhere to start from.
      return { ...base, channel, points: points.length >= 2 ? points : base.points };
    }
    case 'hue-saturation':
      return {
        ...base,
        hue: clamped(v.hue, base.hue, -180, 180),
        saturation: clamped(v.saturation, base.saturation, -100, 100),
        lightness: clamped(v.lightness, base.lightness, -100, 100),
      };
    case 'color-balance':
      return {
        ...base,
        red: clamped(v.red, base.red, -100, 100),
        green: clamped(v.green, base.green, -100, 100),
        blue: clamped(v.blue, base.blue, -100, 100),
      };
    case 'exposure':
      return {
        ...base,
        exposure: clamped(v.exposure, base.exposure, -10, 10),
        offset: clamped(v.offset, base.offset, -1, 1),
        gamma: clamped(v.gamma, base.gamma, 0.01, 10),
      };
    case 'grayscale':
      return { ...base, amount: clamped(v.amount, base.amount, 0, 100) };
    case 'posterize':
      return { ...base, levels: Math.round(clamped(v.levels, base.levels, 2, 255)) };
  }
}

/**
 * A stored filter.
 *
 * Built from the kind's own defaults and then clamped, on the same terms as a
 * brush restored from `localStorage`: a filter is a number that reaches a loop
 * over every pixel, and a hand-edited radius of 10,000 is a hung tab rather
 * than a strange-looking blur.
 */
function filterSpec(v: unknown): FilterSpec | null {
  if (!isRecord(v)) return null;
  const kind = str(v.kind, '');
  if (!(FILTER_KINDS as readonly string[]).includes(kind)) return null;

  const base = { ...createFilter(kind as FilterKind), id: str(v.id, newId()), enabled: bool(v.enabled, true) };
  switch (base.kind) {
    case 'blur':
      return clampFilter({ ...base, radius: num(v.radius, base.radius) });
    case 'sharpen':
      return clampFilter({ ...base, amount: num(v.amount, base.amount) });
    case 'pixelate':
      return clampFilter({ ...base, size: num(v.size, base.size) });
    case 'drop-shadow':
      return clampFilter({
        ...base,
        dx: num(v.dx, base.dx),
        dy: num(v.dy, base.dy),
        blur: num(v.blur, base.blur),
        color: str(v.color, base.color),
        opacity: num(v.opacity, base.opacity),
      });
    case 'glow':
      return clampFilter({
        ...base,
        radius: num(v.radius, base.radius),
        color: str(v.color, base.color),
        strength: num(v.strength, base.strength),
      });
    case 'noise':
      return clampFilter({
        ...base,
        amount: num(v.amount, base.amount),
        monochrome: bool(v.monochrome, base.monochrome),
      });
  }
}

function filters(v: unknown): FilterSpec[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const parsed = v.map(filterSpec).filter((f): f is FilterSpec => f !== null);
  // Absent rather than `[]`, so a layer with no filters serialises without the
  // field — the same rule `subpaths` follows.
  return parsed.length ? parsed : undefined;
}

function vectorStyle(v: unknown): VectorStyle {
  if (!isRecord(v)) return { ...DEFAULT_VECTOR_STYLE };
  const styles: StrokeStyle[] = ['solid', 'dashed', 'dotted', 'long-dash'];
  const strokeStyle = str(v.strokeStyle, 'solid');
  return {
    fill: str(v.fill, DEFAULT_VECTOR_STYLE.fill),
    stroke: str(v.stroke, DEFAULT_VECTOR_STYLE.stroke),
    strokeWidth: clamped(v.strokeWidth, DEFAULT_VECTOR_STYLE.strokeWidth, 0, 512),
    strokeStyle: (styles as string[]).includes(strokeStyle) ? (strokeStyle as StrokeStyle) : 'solid',
  };
}

function vectorObject(v: unknown): VectorObject | null {
  if (!isRecord(v)) return null;
  const kind = str(v.kind, '');
  const common = {
    id: str(v.id, newId()),
    name: str(v.name, 'Object'),
    visible: bool(v.visible, true),
    locked: bool(v.locked, false),
    opacity: clamped(v.opacity, 1, 0, 1),
    rotation: num(v.rotation, 0),
    frame: rect(v.frame, { x: 0, y: 0, width: 1, height: 1 }),
    style: vectorStyle(v.style),
  };

  switch (kind) {
    case 'rect':
      return { ...common, kind: 'rect', cornerRadius: clamped(v.cornerRadius, 0, 0, 4096) };
    case 'ellipse':
      return { ...common, kind: 'ellipse' };
    case 'line':
      return {
        ...common,
        kind: 'line',
        arrowStart: bool(v.arrowStart, false),
        arrowEnd: bool(v.arrowEnd, false),
      };
    case 'path': {
      const subpaths = Array.isArray(v.subpaths)
        ? v.subpaths.map(subPath).filter((s): s is SubPath => s !== null)
        : [];
      return {
        ...common,
        kind: 'path',
        points: pathPoints(v.points),
        closed: bool(v.closed, false),
        // Absent rather than `[]` when there are none: the field is optional
        // precisely so an ordinary single-contour path serialises without it,
        // and writing an empty array puts it back into every path in the file.
        ...(subpaths.length ? { subpaths } : {}),
        ...(v.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
      };
    }
    default:
      return null;
  }
}

/**
 * A stored path point.
 *
 * A handle is kept only when it parses as a point, so `in: null` — which is
 * what a hand edit or another tool's JSON is most likely to produce for "no
 * handle" — reads as a corner rather than as a control point at the origin,
 * which would fling the curve to the top-left of the canvas.
 */
function pathPoint(v: unknown): PathPoint {
  if (!isRecord(v)) return { x: 0, y: 0 };
  const anchor: PathPoint = { x: num(v.x, 0), y: num(v.y, 0) };
  if (isRecord(v.in)) anchor.in = point(v.in, anchor);
  if (isRecord(v.out)) anchor.out = point(v.out, anchor);
  return anchor;
}

function pathPoints(v: unknown): PathPoint[] {
  return Array.isArray(v) ? v.map(pathPoint) : [];
}

function subPath(v: unknown): SubPath | null {
  if (!isRecord(v)) return null;
  const points = pathPoints(v.points);
  // A contour of fewer than two points draws nothing and would only ever be a
  // stray entry; dropping it keeps `pathContours` free of empty cases.
  if (points.length < 2) return null;
  return { points, closed: bool(v.closed, false) };
}

function textPath(v: unknown): TextPathBinding | undefined {
  if (!isRecord(v)) return undefined;
  const pathId = str(v.pathId, '');
  // A binding with no target is not a binding. Dropping it lays the text out in
  // its box instead, which is visible and editable, rather than leaving a
  // dangling reference the renderer has to guard on every frame.
  if (!pathId) return undefined;
  const align = v.align === 'middle' || v.align === 'end' ? v.align : 'start';
  return {
    pathId,
    startOffset: clamped(v.startOffset, 0, 0, 100),
    align,
    baselineOffset: clamped(v.baselineOffset, 0, -4096, 4096),
    side: v.side === 'right' ? 'right' : 'left',
  };
}

function nodeBase(v: Raw, fallbackName: string): NodeBase {
  const created = isoDate(v.createdAt, new Date().toISOString());
  const chain = filters(v.filters);
  return {
    id: str(v.id, newId()),
    name: str(v.name, fallbackName),
    // Rebuilt from `children` by `normalizeTree` below; whatever was stored is
    // only a hint and is never trusted over the structure itself.
    parentId: typeof v.parentId === 'string' ? v.parentId : null,
    visible: bool(v.visible, true),
    opacity: clamped(v.opacity, 1, 0, 1),
    blendMode: blendMode(v.blendMode),
    locked: bool(v.locked, false),
    transform: transform(v.transform),
    bounds: rect(v.bounds, { x: 0, y: 0, width: 0, height: 0 }),
    createdAt: created,
    modifiedAt: isoDate(v.modifiedAt, created),
    mask: mask(v.mask),
    ...(chain ? { filters: chain } : {}),
  };
}

function node(v: unknown): DrawingNode | null {
  if (!isRecord(v)) return null;
  const base = nodeBase(v, 'Layer');

  switch (str(v.type, '')) {
    case 'stack':
      return {
        ...base,
        name: str(v.name, 'Group'),
        type: 'stack',
        isolation: v.isolation === 'isolate' ? 'isolate' : 'auto',
        children: Array.isArray(v.children)
          ? v.children.map(node).filter((n): n is DrawingNode => n !== null)
          : [],
      };
    case 'raster': {
      const source = rasterSource(v.source);
      if (!source) return null;
      const assetId = str(v.assetId, '');
      return {
        ...base,
        name: str(v.name, 'Image'),
        type: 'raster',
        source,
        ...(assetId ? { assetId } : {}),
      };
    }
    case 'adjustment':
      return {
        ...base,
        name: str(v.name, 'Adjustment'),
        type: 'adjustment',
        adjustment: adjustment(v.adjustment),
      };
    case 'vector':
      return {
        ...base,
        type: 'vector',
        objects: Array.isArray(v.objects)
          ? v.objects.map(vectorObject).filter((o): o is VectorObject => o !== null)
          : [],
      };
    case 'text': {
      const binding = textPath(v.textPath);
      return {
        ...base,
        name: str(v.name, 'Text'),
        type: 'text',
        text: str(v.text, ''),
        fontFamily: str(v.fontFamily, 'sans-serif'),
        fontSize: clamped(v.fontSize, 24, 1, 2000),
        fontWeight: clamped(v.fontWeight, 400, 100, 900),
        italic: bool(v.italic, false),
        align: v.align === 'center' || v.align === 'right' ? v.align : 'left',
        lineHeight: clamped(v.lineHeight, 1.2, 0.5, 10),
        color: str(v.color, '#000000'),
        box: rect(v.box, { x: 0, y: 0, width: 200, height: 40 }),
        ...(binding ? { textPath: binding } : {}),
      };
    }
    case 'instance': {
      const symbolId = str(v.symbolId, '');
      // An instance of nothing draws nothing and cannot be given a symbol from
      // the UI, so it is dropped rather than kept as an empty row in the layers
      // panel that no action can repair.
      if (!symbolId) return null;
      return { ...base, name: str(v.name, 'Instance'), type: 'instance', symbolId };
    }
    default:
      return null;
  }
}

function symbolDefinition(v: unknown): SymbolDefinition | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, '');
  const content = node(v.content);
  if (!id || !content) return null;
  return { id, name: str(v.name, 'Symbol'), content, createdAt: isoDate(v.createdAt, new Date().toISOString()) };
}

/**
 * A stored selection.
 *
 * Undefined for anything unrecognised, which reads as "nothing selected" —
 * the state every operation already handles, and the only safe guess: a
 * selection restored wrongly silently confines the next brush stroke to the
 * wrong part of the canvas.
 */
function selectionShape(v: unknown): SelectionShape | undefined {
  if (!isRecord(v)) return undefined;
  switch (str(v.kind, '')) {
    case 'rect':
      return { kind: 'rect', rect: rect(v.rect, { x: 0, y: 0, width: 0, height: 0 }) };
    case 'ellipse':
      return { kind: 'ellipse', rect: rect(v.rect, { x: 0, y: 0, width: 0, height: 0 }) };
    case 'lasso': {
      const points = Array.isArray(v.points) ? v.points.map((p) => point(p, { x: 0, y: 0 })) : [];
      return points.length >= 3 ? { kind: 'lasso', points } : undefined;
    }
    case 'mask': {
      const source = rasterSource(v.source);
      return source ? { kind: 'mask', source } : undefined;
    }
    default:
      return undefined;
  }
}

function canvasSettings(v: unknown): CanvasSettings {
  if (!isRecord(v)) return { ...DEFAULT_CANVAS };
  return {
    // A canvas is a real allocation on export — width × height × 4 bytes — so
    // the ceiling is a guard against a body that would hang the tab, not a
    // product limit anyone will reach.
    width: Math.round(clamped(v.width, DEFAULT_CANVAS.width, 1, 30000)),
    height: Math.round(clamped(v.height, DEFAULT_CANVAS.height, 1, 30000)),
    dpi: clamped(v.dpi, DEFAULT_CANVAS.dpi, 1, 10000),
    background: typeof v.background === 'string' ? v.background : null,
  };
}

/**
 * A stored colour profile.
 *
 * `iccUri` is dropped unless it is an ICC data URL, for the same reason a
 * raster source is dropped unless it is an image one: a document is not a place
 * from which to fetch things, and an `iccUri` pointing at somebody's server
 * would be a request made on opening a file.
 */
function colorProfile(v: unknown): ColorProfile {
  if (!isRecord(v)) return { name: 'sRGB', space: 'srgb', bitDepth: 8 };
  const iccUri = str(v.iccUri, '');
  return {
    name: str(v.name, 'sRGB'),
    ...(/^data:application\/(vnd\.iccprofile|octet-stream);base64,/i.test(iccUri) ? { iccUri } : {}),
    space: isColorSpaceName(v.space) ? v.space : 'srgb',
    bitDepth: v.bitDepth === 16 ? 16 : 8,
    ...(isRecord(v.hdr) ? { hdr: hdrSettings(v.hdr) } : {}),
  };
}

function hdrSettings(v: Raw): HdrSettings {
  return {
    enabled: bool(v.enabled, DEFAULT_HDR.enabled),
    transfer: v.transfer === 'hlg' ? 'hlg' : 'pq',
    headroom: clamped(v.headroom, DEFAULT_HDR.headroom, 1, 8),
  };
}

/**
 * Stored asset provenance.
 *
 * An entry with no `uri` is dropped: provenance that cannot say where anything
 * came from is a row in a panel with nothing in it, and the layer it described
 * still has its own pixels either way.
 */
function linkedAsset(v: unknown): LinkedAsset | null {
  if (!isRecord(v)) return null;
  const uri = str(v.uri, '');
  if (!uri) return null;
  return {
    id: str(v.id, newId()),
    uri,
    name: str(v.name, 'Asset'),
    hash: str(v.hash, ''),
    width: Math.max(1, Math.round(num(v.width, 1))),
    height: Math.max(1, Math.round(num(v.height, 1))),
    importedAt: isoDate(v.importedAt, new Date().toISOString()),
    // Re-derived rather than trusted: whether a URI can be fetched again is a
    // property of the URI, and a stored `true` beside a local filename would
    // offer a Reload button that can only fail.
    linked: bool(v.linked, true) && isReloadableUri(uri),
  };
}

function snapSettings(v: unknown): SnapSettings {
  if (!isRecord(v)) return { ...DEFAULT_SNAP };
  return {
    guides: bool(v.guides, DEFAULT_SNAP.guides),
    objects: bool(v.objects, DEFAULT_SNAP.objects),
    canvas: bool(v.canvas, DEFAULT_SNAP.canvas),
    tolerance: clamped(v.tolerance, DEFAULT_SNAP.tolerance, 0, 200),
  };
}

function workspace(v: unknown): WorkspaceState | undefined {
  if (!isRecord(v)) return undefined;
  const selectedIds = Array.isArray(v.selectedIds)
    ? v.selectedIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    rulers: bool(v.rulers, DEFAULT_WORKSPACE.rulers),
    units: isRulerUnit(v.units) ? v.units : DEFAULT_WORKSPACE.units,
    showGuides: bool(v.showGuides, DEFAULT_WORKSPACE.showGuides),
    lockGuides: bool(v.lockGuides, DEFAULT_WORKSPACE.lockGuides),
    snap: snapSettings(v.snap),
    // Wrapped to 0–360 rather than clamped: a rotation is an angle, and −90 and
    // 270 are the same view.
    canvasRotation: ((num(v.canvasRotation, 0) % 360) + 360) % 360,
    ...(typeof v.activeTool === 'string' ? { activeTool: v.activeTool } : {}),
    ...(typeof v.activeLayerId === 'string' ? { activeLayerId: v.activeLayerId } : {}),
    ...(selectedIds.length ? { selectedIds } : {}),
  };
}

function guides(v: unknown): Guide[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRecord).map((g) => ({
    id: str(g.id, newId()),
    orientation: g.orientation === 'vertical' ? 'vertical' : 'horizontal',
    position: num(g.position, 0),
  }));
}

/**
 * A stored body as a document.
 *
 * `null` means "not a version 2 drawing" — an empty body, unparseable JSON, or
 * a version this build does not write. The caller opens a new document in that
 * case; there is deliberately no conversion path from anything else.
 */
export function parseDocument(raw: string): DrawingDocument | null {
  if (!raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== DOCUMENT_VERSION) return null;

  const rootRaw = isRecord(parsed.root) ? parsed.root : {};
  const rootNode = node({ ...rootRaw, type: 'stack' });
  const root: StackNode = rootNode && rootNode.type === 'stack'
    ? rootNode
    : { ...(node({ type: 'stack', name: 'Root' }) as StackNode) };

  const meta = isRecord(parsed.metadata) ? parsed.metadata : {};
  const created = isoDate(meta.createdAt, new Date().toISOString());
  const gridRaw = isRecord(parsed.grid) ? parsed.grid : {};
  const viewportRaw = isRecord(parsed.viewport) ? parsed.viewport : null;

  const symbols = Array.isArray(parsed.symbols)
    ? parsed.symbols.map(symbolDefinition).filter((s): s is SymbolDefinition => s !== null)
    : [];
  const assets = Array.isArray(parsed.assets)
    ? parsed.assets.map(linkedAsset).filter((a): a is LinkedAsset => a !== null)
    : [];
  const workspaceState = workspace(parsed.workspace);
  // Bounds are refreshed *after* the symbols are known, because an instance's
  // extent is its symbol's. Doing it in the other order gives every instance in
  // a freshly loaded document a zero-sized bounding box, which is an
  // unselectable layer with no selection frame.
  const symbols_ = new Map(symbols.map((s) => [s.id, s]));
  const selection = selectionShape(parsed.selection);

  return {
    version: DOCUMENT_VERSION,
    canvas: canvasSettings(parsed.canvas),
    root: refreshBounds(normalizeTree(root), symbols_),
    guides: guides(parsed.guides),
    ...(symbols.length ? { symbols } : {}),
    ...(selection ? { selection } : {}),
    ...(assets.length ? { assets } : {}),
    ...(workspaceState ? { workspace: workspaceState } : {}),
    grid: {
      visible: bool(gridRaw.visible, DEFAULT_GRID.visible),
      size: clamped(gridRaw.size, DEFAULT_GRID.size, 1, 1000),
      origin: point(gridRaw.origin, DEFAULT_GRID.origin),
      snap: bool(gridRaw.snap, DEFAULT_GRID.snap),
      subdivisions: Math.round(clamped(gridRaw.subdivisions, DEFAULT_GRID.subdivisions, 1, 100)),
    },
    colorProfile: colorProfile(parsed.colorProfile),
    metadata: {
      title: str(meta.title, 'Untitled drawing'),
      ...(typeof meta.author === 'string' ? { author: meta.author } : {}),
      ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
      createdAt: created,
      modifiedAt: isoDate(meta.modifiedAt, created),
      application: {
        name: isRecord(meta.application) ? str(meta.application.name, APPLICATION_NAME) : APPLICATION_NAME,
        version: isRecord(meta.application) ? str(meta.application.version, APPLICATION_VERSION) : APPLICATION_VERSION,
      },
    },
    ...(viewportRaw
      ? {
          viewport: {
            x: num(viewportRaw.x, 0),
            y: num(viewportRaw.y, 0),
            scale: clamped(viewportRaw.scale, 1, 0.01, 100),
          },
        }
      : {}),
  };
}

/**
 * Assets no layer refers to any more.
 *
 * Provenance outlives nothing: delete the layer an image came from and the row
 * describing where it came from is a fact about a picture that is no longer in
 * the drawing. Pruned on save rather than on delete, so an undone deletion gets
 * its asset back — the same reason `bounds` is recomputed here rather than
 * maintained at every edit site.
 */
function pruneAssets(doc: DrawingDocument): LinkedAsset[] | undefined {
  const assets = doc.assets;
  if (!assets?.length) return undefined;

  const referenced = new Set<string>();
  const walk = (node: DrawingNode): void => {
    if (node.type === 'raster' && node.assetId) referenced.add(node.assetId);
    if (node.type === 'stack') node.children.forEach(walk);
  };
  walk(doc.root);
  for (const symbol of doc.symbols ?? []) walk(symbol.content);

  const kept = assets.filter((asset) => referenced.has(asset.id));
  return kept.length ? kept : undefined;
}

/** A body, ready to encrypt. Stamps `modifiedAt` and the writing application. */
export function serializeDocument(doc: DrawingDocument): string {
  const assets = pruneAssets(doc);
  const stamped: DrawingDocument = {
    ...doc,
    root: refreshBounds(normalizeTree(doc.root), symbolTable(doc)),
    ...(assets ? { assets } : { assets: undefined }),
    metadata: {
      ...doc.metadata,
      modifiedAt: new Date().toISOString(),
      application: { name: APPLICATION_NAME, version: APPLICATION_VERSION },
    },
  };
  return JSON.stringify(stamped);
}

/** A body for a drawing that has never been saved. Mirrors the backend's seed. */
export function emptyDocumentBody(title = 'Untitled drawing'): string {
  return JSON.stringify(createDocument({ title }));
}
