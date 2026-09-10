/**
 * The drawing document's layer tree.
 *
 * Three properties are load-bearing enough that everything else is built on
 * them being true, and each has a way of failing quietly:
 *
 * - **`children[0]` is the topmost layer**, matching OpenRaster. Get it
 *   backwards and the picture is inverted with no error anywhere.
 * - **`parentId` follows `children`**, rebuilt rather than hand-maintained, so
 *   a document that has been through a save, a hand edit or another
 *   application cannot arrive with the two disagreeing.
 * - **A group cannot be moved into itself**, which would detach the branch from
 *   the tree and lose every layer under it.
 */

import { describe, it, expect } from 'vitest';

import {
  createDocument,
  createRasterLayer,
  createRect,
  createStack,
  createTextLayer,
  createVectorLayer,
} from '../../app/(apps)/drawing/editor/document/factory';
import {
  ancestorsOf,
  contentBounds,
  documentContentBounds,
  findNode,
  findParent,
  flattenTree,
  groupNodes,
  insertNode,
  isDocumentEmpty,
  isEffectivelyLocked,
  isEffectivelyVisible,
  isSelfOrDescendant,
  moveNode,
  normalizeTree,
  paintOrder,
  refreshBounds,
  removeNode,
  reorderWithinParent,
  ungroupNode,
  updateNode,
} from '../../app/(apps)/drawing/editor/document/tree';
import { addObjects, cloneNode, translateNode } from '../../app/(apps)/drawing/editor/document/edits';
import type { StackNode, VectorLayerNode } from '../../app/(apps)/drawing/editor/types';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function rasterSource(overrides: Partial<{ x: number; y: number; width: number; height: number }> = {}) {
  return { dataUrl: PIXEL, width: 10, height: 10, x: 0, y: 0, ...overrides };
}

/** Root → [top, middle, bottom], with `top` the first child. */
function threeLayers() {
  const root = createStack('Root');
  const top = createVectorLayer('Top');
  const middle = createVectorLayer('Middle');
  const bottom = createVectorLayer('Bottom');
  root.children = [top, middle, bottom];
  return { root: normalizeTree(root), top, middle, bottom };
}

describe('ordering', () => {
  it('treats the first child as the topmost layer', () => {
    const { root } = threeLayers();
    expect(root.children.map((c) => c.name)).toEqual(['Top', 'Middle', 'Bottom']);
    expect(flattenTree(root).map((f) => f.node.name)).toEqual(['Top', 'Middle', 'Bottom']);
  });

  it('paints bottom to top — the reverse of the children order', () => {
    const { root } = threeLayers();
    expect(paintOrder(root).map((c) => c.name)).toEqual(['Bottom', 'Middle', 'Top']);
  });

  it('inserts a new layer on top by default', () => {
    const { root } = threeLayers();
    const added = insertNode(root, createVectorLayer('New'));
    expect(added.children.map((c) => c.name)).toEqual(['New', 'Top', 'Middle', 'Bottom']);
  });

  it('moves a layer forward with a negative delta, because index 0 is the top', () => {
    const { root, bottom } = threeLayers();
    const forward = reorderWithinParent(root, bottom.id, -1);
    expect(forward.children.map((c) => c.name)).toEqual(['Top', 'Bottom', 'Middle']);
  });

  it('clamps a reorder at the ends rather than wrapping', () => {
    const { root, top } = threeLayers();
    expect(reorderWithinParent(root, top.id, -5).children.map((c) => c.name))
      .toEqual(['Top', 'Middle', 'Bottom']);
  });
});

describe('parentId', () => {
  it('is set on insert', () => {
    const root = createStack('Root');
    const layer = createVectorLayer('Layer');
    const next = insertNode(root, layer);
    expect(next.children[0].parentId).toBe(root.id);
  });

  it('is rewritten on a move', () => {
    const { root, top, bottom } = threeLayers();
    const group = createStack('Group');
    const withGroup = insertNode(root, group);
    const moved = moveNode(withGroup, bottom.id, { parentId: group.id, index: 0 });

    const relocated = findNode(moved, bottom.id)!;
    expect(relocated.parentId).toBe(group.id);
    expect(findParent(moved, bottom.id)?.id).toBe(group.id);
    // The untouched sibling keeps its own parent.
    expect(findNode(moved, top.id)!.parentId).toBe(root.id);
  });

  it('is rebuilt from the structure, so a stored lie is corrected', () => {
    const group = createStack('Group');
    const layer = createVectorLayer('Layer');
    // A hand-edited or foreign document: the child says it belongs elsewhere.
    group.children = [{ ...layer, parentId: 'somewhere-else' }];
    const root = createStack('Root');
    root.children = [group];

    const fixed = normalizeTree(root);
    expect(findNode(fixed, layer.id)!.parentId).toBe(group.id);
    expect(fixed.parentId).toBeNull();
  });

  it('returns the same object when nothing needed fixing', () => {
    const { root } = threeLayers();
    expect(normalizeTree(root)).toBe(root);
  });
});

describe('groups', () => {
  it('lists ancestors outermost first', () => {
    const inner = createVectorLayer('Inner');
    const innerGroup = createStack('Inner group');
    innerGroup.children = [inner];
    const outerGroup = createStack('Outer group');
    outerGroup.children = [innerGroup];
    const root = normalizeTree(Object.assign(createStack('Root'), { children: [outerGroup] }));

    expect(ancestorsOf(root, inner.id).map((a) => a.name))
      .toEqual(['Root', 'Outer group', 'Inner group']);
  });

  it('refuses to move a group into its own subtree', () => {
    const child = createVectorLayer('Child');
    const group = createStack('Group');
    group.children = [child];
    const root = normalizeTree(Object.assign(createStack('Root'), { children: [group] }));

    // Moving the group inside its own child would detach the whole branch.
    expect(moveNode(root, group.id, { parentId: child.id, index: 0 })).toBe(root);
    expect(isSelfOrDescendant(root, group.id, child.id)).toBe(true);
    expect(isSelfOrDescendant(root, child.id, group.id)).toBe(false);
  });

  it('puts a new group where the topmost of its members was', () => {
    const { root, middle, bottom } = threeLayers();
    const group = createStack('Group');
    const grouped = groupNodes(root, [middle.id, bottom.id], group);

    expect(grouped.children.map((c) => c.name)).toEqual(['Top', 'Group']);
    const placed = findNode(grouped, group.id) as StackNode;
    // The members keep their relative order.
    expect(placed.children.map((c) => c.name)).toEqual(['Middle', 'Bottom']);
    expect(placed.children.every((c) => c.parentId === group.id)).toBe(true);
  });

  it('ungroups back to the group’s own position', () => {
    const { root, middle, bottom } = threeLayers();
    const group = createStack('Group');
    const grouped = groupNodes(root, [middle.id, bottom.id], group);
    const flat = ungroupNode(grouped, group.id);

    expect(flat.children.map((c) => c.name)).toEqual(['Top', 'Middle', 'Bottom']);
    expect(flat.children.every((c) => c.parentId === flat.id)).toBe(true);
  });
});

describe('effective visibility and lock', () => {
  it('hides a visible layer inside a hidden group', () => {
    const layer = createVectorLayer('Layer');
    const group = createStack('Group');
    group.children = [layer];
    let root = normalizeTree(Object.assign(createStack('Root'), { children: [group] }));

    expect(isEffectivelyVisible(root, layer.id)).toBe(true);
    root = updateNode(root, group.id, (node) => ({ ...node, visible: false }));
    expect(isEffectivelyVisible(root, layer.id)).toBe(false);
    // The layer's own flag is untouched — unhiding the group restores it.
    expect(findNode(root, layer.id)!.visible).toBe(true);
  });

  it('locks a layer inside a locked group', () => {
    const layer = createVectorLayer('Layer');
    const group = createStack('Group');
    group.children = [layer];
    let root = normalizeTree(Object.assign(createStack('Root'), { children: [group] }));

    expect(isEffectivelyLocked(root, layer.id)).toBe(false);
    root = updateNode(root, group.id, (node) => ({ ...node, locked: true }));
    expect(isEffectivelyLocked(root, layer.id)).toBe(true);
  });
});

describe('bounds', () => {
  it('measures a raster layer from its source rectangle', () => {
    const layer = createRasterLayer(rasterSource({ x: 20, y: 30, width: 40, height: 50 }));
    expect(contentBounds(layer)).toEqual({ x: 20, y: 30, width: 40, height: 50 });
  });

  it('includes a vector object’s stroke, which straddles its frame', () => {
    const doc = createDocument();
    const layer = flattenTree(doc.root).find((f) => f.node.type === 'vector')!.node;
    const rect = createRect({ x: 100, y: 100, width: 50, height: 50 }, { strokeWidth: 10 });
    const withRect = addObjects(doc, layer.id, [rect]);

    // Half the stroke sits outside the frame on every side.
    expect(contentBounds(findNode(withRect.root, layer.id)!)).toEqual({
      x: 95, y: 95, width: 60, height: 60,
    });
  });

  it('applies an enclosing group’s transform to the document extent', () => {
    const layer = createRasterLayer(rasterSource({ x: 0, y: 0, width: 10, height: 10 }));
    const group = createStack('Group');
    group.children = [layer];
    const doc = { ...createDocument(), root: normalizeTree(Object.assign(createStack('Root'), { children: [group] })) };

    const moved = translateNode(doc, group.id, 100, 200);
    expect(documentContentBounds(moved)).toEqual({ x: 100, y: 200, width: 10, height: 10 });
  });

  it('recomputes stale stored bounds on refresh', () => {
    const layer = createRasterLayer(rasterSource({ x: 5, y: 5, width: 20, height: 20 }));
    // A document whose cached bounds no longer match its content.
    const stale = { ...layer, bounds: { x: 0, y: 0, width: 1, height: 1 } };
    const root = normalizeTree(Object.assign(createStack('Root'), { children: [stale] }));

    const fresh = refreshBounds(root);
    expect(findNode(fresh, layer.id)!.bounds).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });
});

describe('emptiness', () => {
  it('calls a new document empty', () => {
    expect(isDocumentEmpty(createDocument())).toBe(true);
  });

  it('stops being empty once anything is drawn', () => {
    const doc = createDocument();
    const layer = flattenTree(doc.root).find((f) => f.node.type === 'vector')!.node;
    const withRect = addObjects(doc, layer.id, [createRect({ x: 0, y: 0, width: 10, height: 10 })]);
    expect(isDocumentEmpty(withRect)).toBe(false);
  });

  it('counts a text layer as content', () => {
    const doc = createDocument();
    const withText = { ...doc, root: insertNode(doc.root, createTextLayer({ x: 0, y: 0, width: 10, height: 10 }, 'Hi')) };
    expect(isDocumentEmpty(withText)).toBe(false);
  });
});

describe('cloning', () => {
  it('regenerates every id in the subtree', () => {
    const layer = createVectorLayer('Layer');
    const withObject: VectorLayerNode = {
      ...layer,
      objects: [createRect({ x: 0, y: 0, width: 10, height: 10 })],
    };
    const group = createStack('Group');
    group.children = [withObject];

    const copy = cloneNode(group) as StackNode;
    expect(copy.id).not.toBe(group.id);

    const original = group.children[0] as VectorLayerNode;
    const copied = copy.children[0] as VectorLayerNode;
    expect(copied.id).not.toBe(original.id);
    // The object ids too: two objects with one id makes the copy unselectable.
    expect(copied.objects[0].id).not.toBe(original.objects[0].id);
  });
});

describe('removal', () => {
  it('removes a node from anywhere in the tree', () => {
    const { root, middle } = threeLayers();
    const next = removeNode(root, middle.id);
    expect(next.children.map((c) => c.name)).toEqual(['Top', 'Bottom']);
    expect(findNode(next, middle.id)).toBeNull();
  });

  it('leaves the tree alone for an id that is not in it', () => {
    const { root } = threeLayers();
    expect(removeNode(root, 'nope')).toBe(root);
    expect(updateNode(root, 'nope', (n) => ({ ...n, name: 'x' }))).toBe(root);
  });
});
