/**
 * Document-level edits.
 *
 * `tree.ts` rewrites the layer tree; this sits one level up and rewrites the
 * whole `DrawingDocument`, so that the canvas, the layers panel and the style
 * panel all change a drawing through the same small set of named operations
 * instead of each spreading its own object literals over the tree.
 *
 * Everything here is pure. Nothing stamps `metadata.modifiedAt` — that belongs
 * to the save, in `serializeDocument`, because a document is modified once per
 * save and not once per mouse move.
 */

import {
  contentBounds,
  findNode,
  findParent,
  insertNode,
  removeNode,
  symbolTable,
  updateNode,
  updateNodes,
} from './tree';
import { newId } from './ids';
import { multiplyTransform, normalizeRect } from './geometry';
import { mapPathObject } from './path';
import { createStack } from './factory';
import { DEFAULT_HDR, type ColorProfile, type HdrSettings } from './color';
import { clampFilter, type FilterSpec } from './filters';
import { workspaceOf, type SnapSettings, type WorkspaceState } from './workspace';
import type { AdjustmentSpec } from './adjustments';
import type { LinkedAsset } from './assets';
import type {
  CanvasSettings,
  DrawingDocument,
  DrawingNode,
  Guide,
  LayerMask,
  NodeBase,
  RasterSource,
  Rect,
  SelectionShape,
  StackNode,
  SymbolDefinition,
  TextLayerNode,
  TextPathBinding,
  Transform2D,
  VectorLayerNode,
  VectorObject,
} from './types';

function withRoot(doc: DrawingDocument, root: StackNode): DrawingDocument {
  return root === doc.root ? doc : { ...doc, root };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Changes fields shared by every node type — name, opacity, blend mode, lock, visibility. */
export function setNodeProps(
  doc: DrawingDocument,
  id: string,
  patch: Partial<Omit<NodeBase, 'id' | 'createdAt'>>,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => ({ ...node, ...patch }) as DrawingNode));
}

export function setNodesProps(
  doc: DrawingDocument,
  ids: readonly string[],
  patch: Partial<Omit<NodeBase, 'id' | 'createdAt'>>,
): DrawingDocument {
  return withRoot(doc, updateNodes(doc.root, ids, (node) => ({ ...node, ...patch }) as DrawingNode));
}

export function addNode(
  doc: DrawingDocument,
  node: DrawingNode,
  opts: { parentId?: string; index?: number } = {},
): DrawingDocument {
  return withRoot(doc, insertNode(doc.root, node, opts));
}

export function deleteNode(doc: DrawingDocument, id: string): DrawingDocument {
  return withRoot(doc, removeNode(doc.root, id));
}

/** A copy of a node directly above the original, with fresh ids throughout. */
export function duplicateNode(doc: DrawingDocument, id: string): { doc: DrawingDocument; newId: string | null } {
  const node = findNode(doc.root, id);
  const parent = findParent(doc.root, id);
  if (!node || !parent) return { doc, newId: null };

  const copy = cloneNode(node);
  const index = parent.children.findIndex((c) => c.id === id);
  return {
    doc: withRoot(doc, insertNode(doc.root, { ...copy, name: `${node.name} copy` }, {
      parentId: parent.id,
      index,
    })),
    newId: copy.id,
  };
}

/**
 * A deep copy with fresh ids throughout.
 *
 * Every id in the subtree is regenerated. Reusing one would give the document
 * two nodes answering to the same id, and every lookup in `tree.ts` returns the
 * first match — so the copy would be unselectable, unmovable and undeletable.
 */
export function cloneNode(node: DrawingNode): DrawingNode {
  const base = { ...node, id: newId(), mask: node.mask ? { ...node.mask, id: newId() } : undefined };
  if (base.type === 'stack') {
    return { ...base, children: base.children.map(cloneNode) };
  }
  if (base.type === 'vector') {
    return { ...base, objects: base.objects.map((o) => ({ ...o, id: newId() })) };
  }
  return base;
}

/**
 * Moves a node by a canvas-space delta.
 *
 * Where the delta lands depends on the node: a text layer moves its box, a
 * raster layer moves its pixels' offset, a vector layer moves every object, and
 * a group moves its own transform — because a group has no geometry of its own
 * and pushing the delta down into its children would flatten the group's
 * transform into them permanently.
 */
export function translateNode(doc: DrawingDocument, id: string, dx: number, dy: number): DrawingDocument {
  if (dx === 0 && dy === 0) return doc;
  return withRoot(doc, updateNode(doc.root, id, (node) => {
    switch (node.type) {
      case 'text':
        return { ...node, box: { ...node.box, x: node.box.x + dx, y: node.box.y + dy } };
      case 'raster':
        return { ...node, source: { ...node.source, x: node.source.x + dx, y: node.source.y + dy } };
      case 'vector':
        return { ...node, objects: node.objects.map((o) => translateObject(o, dx, dy)) };
      case 'adjustment':
        // A correction has no position: it applies to the layers below it
        // wherever they are, and a mask is what confines it to part of the
        // canvas. Moving one is a gesture with no meaning, so it is a no-op
        // rather than a transform nothing reads.
        return node;
      case 'stack':
      case 'instance':
        // Neither has geometry of its own — a group's is its children's and an
        // instance's belongs to the symbol — so the delta goes into the
        // transform. Pushing it down into a group's children would flatten the
        // group's own transform into them permanently, and into a symbol's
        // content would move every other instance of it.
        return { ...node, transform: { ...node.transform, e: node.transform.e + dx, f: node.transform.f + dy } };
    }
  }));
}

export function setNodeMask(doc: DrawingDocument, id: string, mask: LayerMask | undefined): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => ({ ...node, mask }) as DrawingNode));
}

/** Rewrites a mask's own flags, leaving its channel alone. */
export function patchNodeMask(
  doc: DrawingDocument,
  id: string,
  patch: Partial<Omit<LayerMask, 'id'>>,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.mask ? ({ ...node, mask: { ...node.mask, ...patch } }) as DrawingNode : node));
}

// ---------------------------------------------------------------------------
// Adjustments and filters
// ---------------------------------------------------------------------------

/**
 * Rewrites an adjustment layer's parameters.
 *
 * `Partial<AdjustmentSpec>` and not `Partial<Omit<AdjustmentSpec, 'kind'>>`:
 * `Partial` distributes over a union and `Omit` does not, so the second spells
 * out an intent the compiler then throws away — it reduces to the keys every
 * kind shares, which is `kind` alone, which is to say nothing at all. As
 * written, a field that belongs to no adjustment is refused; a field that
 * belongs to *some other* adjustment is not, and `parseDocument` is what
 * repairs that on the way back in.
 */
export function patchAdjustment(
  doc: DrawingDocument,
  id: string,
  patch: Partial<AdjustmentSpec>,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.type === 'adjustment' ? { ...node, adjustment: { ...node.adjustment, ...patch } as AdjustmentSpec } : node));
}

/** Replaces an adjustment outright — how the kind is changed. */
export function setAdjustment(doc: DrawingDocument, id: string, spec: AdjustmentSpec): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.type === 'adjustment' ? { ...node, adjustment: spec } : node));
}

/** Adds a filter to the end of a node's chain, where it applies last. */
export function addFilter(doc: DrawingDocument, id: string, filter: FilterSpec): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => ({
    ...node,
    filters: [...(node.filters ?? []), filter],
  }) as DrawingNode));
}

export function removeFilter(doc: DrawingDocument, id: string, filterId: string): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => {
    const filters = (node.filters ?? []).filter((f) => f.id !== filterId);
    // Dropped entirely when the last one goes, so a node that has never had a
    // filter and one that no longer has any serialise the same way.
    if (!filters.length) {
      const { filters: _dropped, ...rest } = node;
      return rest as DrawingNode;
    }
    return { ...node, filters } as DrawingNode;
  }));
}

/** Merges a patch into one filter, clamped, leaving the rest of the chain alone. */
export function patchFilter(
  doc: DrawingDocument,
  id: string,
  filterId: string,
  patch: Partial<FilterSpec>,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => {
    if (!node.filters?.some((f) => f.id === filterId)) return node;
    return {
      ...node,
      filters: node.filters.map((f) =>
        (f.id === filterId ? clampFilter({ ...f, ...patch } as FilterSpec) : f)),
    } as DrawingNode;
  }));
}

/**
 * Moves a filter within its chain. `delta` is negative for "earlier".
 *
 * The move is decided *before* the tree is rewritten, because `updateNode`
 * rebuilds the path to a node it was asked to change whether or not the change
 * came to anything — so returning the node untouched from inside it would still
 * produce a new document, and the editor would record an undo step for clicking
 * "move up" on the filter that is already first.
 */
export function reorderFilter(
  doc: DrawingDocument,
  id: string,
  filterId: string,
  delta: number,
): DrawingDocument {
  const node = findNode(doc.root, id);
  const filters = node?.filters;
  if (!filters) return doc;
  const from = filters.findIndex((f) => f.id === filterId);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(filters.length - 1, from + delta));
  if (to === from) return doc;

  const reordered = [...filters];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return withRoot(doc, updateNode(doc.root, id, (target) =>
    ({ ...target, filters: reordered }) as DrawingNode));
}

// ---------------------------------------------------------------------------
// Assets, colour and workspace
// ---------------------------------------------------------------------------

export function addAsset(doc: DrawingDocument, asset: LinkedAsset): DrawingDocument {
  return { ...doc, assets: [...(doc.assets ?? []), asset] };
}

export function patchAsset(
  doc: DrawingDocument,
  assetId: string,
  patch: Partial<Omit<LinkedAsset, 'id'>>,
): DrawingDocument {
  const assets = doc.assets ?? [];
  if (!assets.some((a) => a.id === assetId)) return doc;
  return { ...doc, assets: assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a)) };
}

/**
 * Points a raster layer at an asset, adding the asset if it is new.
 *
 * One call rather than two because the two are never useful apart: an asset
 * nothing references is pruned on the next save, and a layer pointing at an
 * asset that was never added describes nothing.
 */
export function attachAsset(doc: DrawingDocument, nodeId: string, asset: LinkedAsset): DrawingDocument {
  const withAsset = doc.assets?.some((a) => a.id === asset.id) ? doc : addAsset(doc, asset);
  return withRoot(withAsset, updateNode(withAsset.root, nodeId, (node) =>
    (node.type === 'raster' ? { ...node, assetId: asset.id } : node)));
}

export function setColorProfile(doc: DrawingDocument, patch: Partial<ColorProfile>): DrawingDocument {
  return { ...doc, colorProfile: { ...doc.colorProfile, ...patch } };
}

export function setHdr(doc: DrawingDocument, patch: Partial<HdrSettings>): DrawingDocument {
  const current = doc.colorProfile.hdr ?? DEFAULT_HDR;
  return setColorProfile(doc, { hdr: { ...current, ...patch } });
}

export function setWorkspace(doc: DrawingDocument, patch: Partial<WorkspaceState>): DrawingDocument {
  return { ...doc, workspace: { ...workspaceOf(doc.workspace), ...patch } };
}

export function setSnap(doc: DrawingDocument, patch: Partial<SnapSettings>): DrawingDocument {
  const workspace = workspaceOf(doc.workspace);
  return { ...doc, workspace: { ...workspace, snap: { ...workspace.snap, ...patch } } };
}

/** Moves a guide. Off the canvas is not an error — `removeGuide` is how one goes. */
export function moveGuide(doc: DrawingDocument, id: string, position: number): DrawingDocument {
  return {
    ...doc,
    guides: doc.guides.map((g) => (g.id === id ? { ...g, position } : g)),
  };
}

export function clearGuides(doc: DrawingDocument): DrawingDocument {
  return doc.guides.length ? { ...doc, guides: [] } : doc;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** Replaces a node's own transform outright. */
export function setNodeTransform(doc: DrawingDocument, id: string, transform: Transform2D): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => ({ ...node, transform }) as DrawingNode));
}

/**
 * Composes a transform onto a node, in **canvas space**.
 *
 * `outer × node.transform`, in that order, so the argument describes what
 * happens on screen — drag a handle 40px right and the node moves 40px right,
 * whatever it was already rotated or scaled by. Multiplying the other way round
 * applies the gesture in the node's own coordinates, which sends a rotated node
 * sideways when you drag it down.
 */
export function transformNode(doc: DrawingDocument, id: string, outer: Transform2D): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => ({
    ...node,
    transform: multiplyTransform(outer, node.transform),
  }) as DrawingNode));
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

/**
 * Replaces a raster layer's pixels — how a finished brush stroke lands.
 *
 * The whole `RasterSource` is replaced rather than patched, because a stroke
 * that ran past the layer's old edge changes its size and offset as well as its
 * bytes, and a patch that updated only `dataUrl` would leave the new pixels
 * scaled into the old rectangle.
 */
export function setRasterSource(doc: DrawingDocument, id: string, source: RasterSource): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.type === 'raster'
      ? { ...node, source, bounds: { x: source.x, y: source.y, width: source.width, height: source.height } }
      : node));
}

/** Replaces the channel behind a node's mask — how a stroke painted onto a mask lands. */
export function setMaskSource(doc: DrawingDocument, id: string, source: RasterSource): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.mask ? ({ ...node, mask: { ...node.mask, source } }) as DrawingNode : node));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function setSelection(doc: DrawingDocument, selection: SelectionShape | undefined): DrawingDocument {
  if (!selection) {
    if (!doc.selection) return doc;
    const { selection: _dropped, ...rest } = doc;
    return rest;
  }
  return { ...doc, selection };
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

export function addSymbol(doc: DrawingDocument, symbol: SymbolDefinition): DrawingDocument {
  return { ...doc, symbols: [...(doc.symbols ?? []), symbol] };
}

export function updateSymbol(
  doc: DrawingDocument,
  symbolId: string,
  update: (symbol: SymbolDefinition) => SymbolDefinition,
): DrawingDocument {
  const symbols = doc.symbols ?? [];
  if (!symbols.some((s) => s.id === symbolId)) return doc;
  return { ...doc, symbols: symbols.map((s) => (s.id === symbolId ? update(s) : s)) };
}

/**
 * Removes a symbol, replacing every instance of it with its own content.
 *
 * Deleting the definition and leaving the instances would empty them —
 * `contentBounds` and the renderer both answer "nothing" for an instance with
 * no symbol — so the layers panel would keep rows that draw nothing and cannot
 * be repaired. Materialising them instead is the only outcome that loses no
 * pixels.
 */
export function removeSymbol(doc: DrawingDocument, symbolId: string): DrawingDocument {
  const symbol = (doc.symbols ?? []).find((s) => s.id === symbolId);
  if (!symbol) return doc;

  let root = doc.root;
  for (const node of instancesOf(doc, symbolId)) {
    root = updateNode(root, node.id, (instance) => ({
      ...cloneNode(symbol.content),
      id: instance.id,
      name: instance.name,
      parentId: instance.parentId,
      visible: instance.visible,
      opacity: instance.opacity,
      blendMode: instance.blendMode,
      locked: instance.locked,
      transform: instance.transform,
      mask: instance.mask,
    }));
  }

  const symbols = (doc.symbols ?? []).filter((s) => s.id !== symbolId);
  return { ...withRoot(doc, root), ...(symbols.length ? { symbols } : { symbols: [] }) };
}

/** Turns one instance into an ordinary copy of its symbol's content. */
export function detachInstance(doc: DrawingDocument, id: string): DrawingDocument {
  const node = findNode(doc.root, id);
  if (!node || node.type !== 'instance') return doc;
  const symbol = (doc.symbols ?? []).find((s) => s.id === node.symbolId);
  if (!symbol) return doc;

  return withRoot(doc, updateNode(doc.root, id, (instance) => ({
    ...cloneNode(symbol.content),
    id: instance.id,
    name: instance.name,
    parentId: instance.parentId,
    visible: instance.visible,
    opacity: instance.opacity,
    blendMode: instance.blendMode,
    locked: instance.locked,
    transform: instance.transform,
    mask: instance.mask,
  })));
}

export function instancesOf(doc: DrawingDocument, symbolId: string): DrawingNode[] {
  const out: DrawingNode[] = [];
  const walk = (node: DrawingNode): void => {
    if (node.type === 'instance' && node.symbolId === symbolId) out.push(node);
    if (node.type === 'stack') node.children.forEach(walk);
  };
  doc.root.children.forEach(walk);
  return out;
}

// ---------------------------------------------------------------------------
// Text on a path
// ---------------------------------------------------------------------------

export function setTextPath(
  doc: DrawingDocument,
  id: string,
  binding: TextPathBinding | undefined,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => {
    if (node.type !== 'text') return node;
    if (!binding) {
      const { textPath: _dropped, ...rest } = node;
      return rest;
    }
    return { ...node, textPath: binding };
  }));
}

export function patchTextPath(
  doc: DrawingDocument,
  id: string,
  patch: Partial<TextPathBinding>,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.type === 'text' && node.textPath
      ? { ...node, textPath: { ...node.textPath, ...patch } }
      : node));
}

// ---------------------------------------------------------------------------
// Vector objects
// ---------------------------------------------------------------------------

function asVectorLayer(node: DrawingNode): VectorLayerNode | null {
  return node.type === 'vector' ? node : null;
}

/** Adds objects to the top of a vector layer. Ignored when the target is not one. */
export function addObjects(
  doc: DrawingDocument,
  layerId: string,
  objects: VectorObject[],
): DrawingDocument {
  if (objects.length === 0) return doc;
  return withRoot(doc, updateNode(doc.root, layerId, (node) => {
    const layer = asVectorLayer(node);
    if (!layer) return node;
    // Unshift, not push: `objects[0]` is the topmost, matching `children[0]`.
    return { ...layer, objects: [...objects, ...layer.objects] };
  }));
}

/** Rewrites the named objects through `map`, leaving the rest alone. */
export function mapObjects(
  doc: DrawingDocument,
  layerId: string,
  ids: readonly string[],
  map: (object: VectorObject) => VectorObject,
): DrawingDocument {
  if (ids.length === 0) return doc;
  const targets = new Set(ids);
  return withRoot(doc, updateNode(doc.root, layerId, (node) => {
    const layer = asVectorLayer(node);
    if (!layer) return node;
    let changed = false;
    const objects = layer.objects.map((object) => {
      if (!targets.has(object.id)) return object;
      changed = true;
      return map(object);
    });
    return changed ? { ...layer, objects } : layer;
  }));
}

/**
 * Applies a shallow patch to the named objects.
 *
 * Typed as a patch of the *common* fields only. Kind-specific fields
 * (`cornerRadius`, `arrowEnd`, `points`) go through `mapObjects`, where the
 * caller has the concrete object in hand and TypeScript can check the write —
 * a `Partial<VectorObject>` here would let a `cornerRadius` be spread onto a
 * line.
 */
export function patchObjects(
  doc: DrawingDocument,
  layerId: string,
  ids: readonly string[],
  patch: Partial<Pick<VectorObject, 'name' | 'visible' | 'locked' | 'opacity' | 'rotation' | 'frame' | 'style'>>,
): DrawingDocument {
  return mapObjects(doc, layerId, ids, (object) => ({ ...object, ...patch }) as VectorObject);
}

/** Merges a style patch, so changing the stroke does not clear the fill. */
export function patchObjectStyle(
  doc: DrawingDocument,
  layerId: string,
  ids: readonly string[],
  patch: Partial<VectorObject['style']>,
): DrawingDocument {
  return mapObjects(doc, layerId, ids, (object) => ({
    ...object,
    style: { ...object.style, ...patch },
  }) as VectorObject);
}

/** Replaces a vector layer's whole object list — what the reorder actions need. */
export function setLayerObjects(
  doc: DrawingDocument,
  layerId: string,
  objects: VectorObject[],
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, layerId, (node) => {
    const layer = asVectorLayer(node);
    return layer ? { ...layer, objects } : node;
  }));
}

/**
 * Rewrites a text layer's own fields.
 *
 * Text is the one node type with content that is neither pixels nor objects,
 * so it is the one type with a typed patch of its own rather than going through
 * `setNodeProps`, which only knows the fields every node shares.
 */
export function patchTextLayer(
  doc: DrawingDocument,
  id: string,
  patch: Partial<Omit<TextLayerNode, 'id' | 'type'>>,
): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) =>
    node.type === 'text' ? { ...node, ...patch } : node));
}

export function removeObjects(
  doc: DrawingDocument,
  layerId: string,
  ids: readonly string[],
): DrawingDocument {
  if (ids.length === 0) return doc;
  const targets = new Set(ids);
  return withRoot(doc, updateNode(doc.root, layerId, (node) => {
    const layer = asVectorLayer(node);
    if (!layer) return node;
    return { ...layer, objects: layer.objects.filter((o) => !targets.has(o.id)) };
  }));
}

export function translateObject(object: VectorObject, dx: number, dy: number): VectorObject {
  const frame = { ...object.frame, x: object.frame.x + dx, y: object.frame.y + dy };
  if (object.kind === 'path') {
    // Through `mapPathObject` so control handles move with their anchors and
    // every contour is covered — moving anchors alone leaves the handles behind
    // and turns a smooth curve inside out.
    return { ...mapPathObject(object, (p) => ({ x: p.x + dx, y: p.y + dy })), frame };
  }
  return { ...object, frame };
}

/**
 * Resizes an object to a new frame.
 *
 * A path's points are scaled with the frame rather than left where they were,
 * which is the difference between dragging a handle and watching the stroke
 * stay put inside a growing box.
 */
export function resizeObject(object: VectorObject, frame: Rect): VectorObject {
  const from = normalizeRect(object.frame);
  const to = normalizeRect(frame);
  // A degenerate source has no scale to derive; the new frame is taken as-is.
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  const mapX = (x: number) => to.x + (x - from.x) * scaleX;
  const mapY = (y: number) => to.y + (y - from.y) * scaleY;

  if (object.kind === 'path') {
    return {
      // Scaled with the frame, handles included; leaving them put would grow
      // the box around a stroke that stayed where it was.
      ...mapPathObject(object, (p) => ({ x: mapX(p.x), y: mapY(p.y) })),
      frame,
    };
  }

  if (object.kind === 'line') {
    // A line's frame is *signed* — that is how one rect describes all four
    // directions — so the endpoints are mapped individually. Assigning the
    // normalised frame instead would silently flip every line that points up
    // or to the left into one pointing down and right.
    const x1 = mapX(object.frame.x);
    const y1 = mapY(object.frame.y);
    const x2 = mapX(object.frame.x + object.frame.width);
    const y2 = mapY(object.frame.y + object.frame.height);
    return { ...object, frame: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } };
  }

  return { ...object, frame };
}

/** A copy of each object offset slightly, as a paste or duplicate lands. */
export function offsetCopies(objects: readonly VectorObject[], delta = 16): VectorObject[] {
  return objects.map((object) => ({ ...translateObject(object, delta, delta), id: newId() }));
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export function newGroup(name = 'Group'): StackNode {
  return createStack(name);
}

// ---------------------------------------------------------------------------
// Canvas, guides and grid
// ---------------------------------------------------------------------------

export function setCanvas(doc: DrawingDocument, patch: Partial<CanvasSettings>): DrawingDocument {
  return { ...doc, canvas: { ...doc.canvas, ...patch } };
}

export function setGrid(doc: DrawingDocument, patch: Partial<DrawingDocument['grid']>): DrawingDocument {
  return { ...doc, grid: { ...doc.grid, ...patch } };
}

export function addGuide(doc: DrawingDocument, guide: Omit<Guide, 'id'>): DrawingDocument {
  return { ...doc, guides: [...doc.guides, { ...guide, id: newId() }] };
}

export function removeGuide(doc: DrawingDocument, id: string): DrawingDocument {
  return { ...doc, guides: doc.guides.filter((g) => g.id !== id) };
}

export function setTitle(doc: DrawingDocument, title: string): DrawingDocument {
  return { ...doc, metadata: { ...doc.metadata, title } };
}

export function setViewport(doc: DrawingDocument, viewport: DrawingDocument['viewport']): DrawingDocument {
  return { ...doc, viewport };
}

/**
 * The canvas rectangle that would hold everything currently drawn.
 *
 * Offered as a "fit canvas to content" action rather than applied
 * automatically: a canvas that resized itself whenever a shape moved would make
 * every saved `.ora` a different size from the last one.
 */
export function contentFittedCanvas(doc: DrawingDocument, padding = 32): Rect | null {
  const symbols = symbolTable(doc);
  const rects = doc.root.children
    .map((child) => contentBounds(child, symbols))
    .filter((r): r is Rect => r !== null);
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x)) - padding;
  const y = Math.min(...rects.map((r) => r.y)) - padding;
  const width = Math.max(...rects.map((r) => r.x + r.width)) + padding - x;
  const height = Math.max(...rects.map((r) => r.y + r.height)) + padding - y;
  return { x, y, width, height };
}
