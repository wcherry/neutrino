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
  updateNode,
  updateNodes,
} from './tree';
import { newId } from './ids';
import { normalizeRect } from './geometry';
import { createStack } from './factory';
import type {
  CanvasSettings,
  DrawingDocument,
  DrawingNode,
  Guide,
  LayerMask,
  NodeBase,
  Rect,
  StackNode,
  TextLayerNode,
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
      case 'stack':
        return { ...node, transform: { ...node.transform, e: node.transform.e + dx, f: node.transform.f + dy } };
    }
  }));
}

export function setNodeMask(doc: DrawingDocument, id: string, mask: LayerMask | undefined): DrawingDocument {
  return withRoot(doc, updateNode(doc.root, id, (node) => ({ ...node, mask }) as DrawingNode));
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
    return { ...object, frame, points: object.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
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
      ...object,
      frame,
      // Scaled with the frame; leaving them put would grow the box around a
      // stroke that stayed where it was.
      points: object.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })),
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
  const rects = doc.root.children.map(contentBounds).filter((r): r is Rect => r !== null);
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x)) - padding;
  const y = Math.min(...rects.map((r) => r.y)) - padding;
  const width = Math.max(...rects.map((r) => r.x + r.width)) + padding - x;
  const height = Math.max(...rects.map((r) => r.y + r.height)) + padding - y;
  return { x, y, width, height };
}
