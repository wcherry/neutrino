/**
 * Reading and rewriting the layer tree.
 *
 * Every function here is pure and returns a new tree rather than mutating one:
 * the editor holds the document in React state, so an in-place edit is a change
 * nothing re-renders for. The cost is that a rewrite copies the spine from the
 * root down to the node it touched, which for a layer tree is a handful of
 * objects.
 *
 * Two invariants are maintained here and nowhere else, so that no caller has to
 * remember them:
 *
 * - **`parentId` follows `children`.** Every insert, move and removal sets it,
 *   and `normalizeTree` rebuilds the whole index — which is what `parseDocument`
 *   runs so a hand-edited or foreign document cannot arrive inconsistent.
 * - **`children[0]` is the topmost layer**, as in OpenRaster. `paintOrder`
 *   is the only place that reverses it, and every renderer goes through that
 *   rather than iterating `children` and hoping.
 */

import { multiplyTransform, transformedRectBounds, unionRects, vectorObjectBounds } from './geometry';
import {
  IDENTITY,
  isStack,
  type DrawingDocument,
  type DrawingNode,
  type Rect,
  type StackNode,
  type SymbolDefinition,
  type Transform2D,
} from './types';

/**
 * Symbols by id.
 *
 * An instance carries only a reference, so anything that has to know how large
 * an instance is — bounds, hit testing, the OpenRaster writer sizing its PNG —
 * needs the definitions in hand. Passing them explicitly rather than reaching
 * for the document keeps `tree.ts` operating on a `StackNode` alone, which is
 * what lets a subtree be measured before it is attached to anything.
 */
export type SymbolTable = ReadonlyMap<string, SymbolDefinition>;

export function symbolTable(doc: DrawingDocument): SymbolTable {
  return new Map((doc.symbols ?? []).map((symbol) => [symbol.id, symbol]));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Depth-first, in `children` order — topmost layer first. */
export function visitNodes(node: DrawingNode, visit: (node: DrawingNode, depth: number) => void, depth = 0): void {
  visit(node, depth);
  if (isStack(node)) {
    for (const child of node.children) visitNodes(child, visit, depth + 1);
  }
}

export interface FlatNode {
  node: DrawingNode;
  depth: number;
}

/**
 * The tree as a list, root excluded.
 *
 * The root stack is dropped because it is a container the user never selects,
 * renames, hides or reorders — showing it in the layers panel would give every
 * drawing one undeletable row that does nothing.
 */
export function flattenTree(root: StackNode): FlatNode[] {
  const out: FlatNode[] = [];
  for (const child of root.children) {
    visitNodes(child, (node, depth) => out.push({ node, depth }));
  }
  return out;
}

export function findNode(root: StackNode, id: string): DrawingNode | null {
  let found: DrawingNode | null = null;
  visitNodes(root, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}

export function findParent(root: StackNode, id: string): StackNode | null {
  let found: StackNode | null = null;
  visitNodes(root, (node) => {
    if (!found && isStack(node) && node.children.some((c) => c.id === id)) found = node;
  });
  return found;
}

/** Root first, immediate parent last. */
export function ancestorsOf(root: StackNode, id: string): StackNode[] {
  const trail: StackNode[] = [];
  function walk(stack: StackNode): boolean {
    for (const child of stack.children) {
      if (child.id === id) {
        trail.push(stack);
        return true;
      }
      if (isStack(child) && walk(child)) {
        trail.unshift(stack);
        return true;
      }
    }
    return false;
  }
  walk(root);
  return trail;
}

/** Whether `id` is `ancestorId` or sits underneath it. Guards moving a group into itself. */
export function isSelfOrDescendant(root: StackNode, ancestorId: string, id: string): boolean {
  if (ancestorId === id) return true;
  const ancestor = findNode(root, ancestorId);
  if (!ancestor || !isStack(ancestor)) return false;
  let found = false;
  visitNodes(ancestor, (node) => {
    if (node.id === id) found = true;
  });
  return found;
}

/** A stack's children bottom-to-top, which is the order they are composited in. */
export function paintOrder(stack: StackNode): DrawingNode[] {
  return [...stack.children].reverse();
}

/**
 * Whether a node draws, accounting for every ancestor.
 *
 * A layer marked visible inside a hidden group is not visible, and the tree is
 * the only place that answer lives.
 */
export function isEffectivelyVisible(root: StackNode, id: string): boolean {
  const node = findNode(root, id);
  if (!node || !node.visible) return false;
  return ancestorsOf(root, id).every((a) => a.id === root.id || a.visible);
}

/** Locked directly, or inside a locked group. */
export function isEffectivelyLocked(root: StackNode, id: string): boolean {
  const node = findNode(root, id);
  if (!node) return false;
  if (node.locked) return true;
  return ancestorsOf(root, id).some((a) => a.id !== root.id && a.locked);
}

/** The layers that can hold drawn objects, topmost first. */
export function vectorLayers(root: StackNode): DrawingNode[] {
  return flattenTree(root).filter((f) => f.node.type === 'vector').map((f) => f.node);
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/**
 * Replaces one node with the result of `update`, rebuilding the path to it.
 *
 * Returns the original root untouched when no node matches, so a caller acting
 * on a stale id changes nothing rather than corrupting the tree.
 */
export function updateNode(
  root: StackNode,
  id: string,
  update: (node: DrawingNode) => DrawingNode,
): StackNode {
  function rewrite(stack: StackNode): StackNode {
    let changed = false;
    const children = stack.children.map((child) => {
      if (child.id === id) {
        changed = true;
        return touch(update(child));
      }
      if (isStack(child)) {
        const next = rewrite(child);
        if (next !== child) {
          changed = true;
          return next;
        }
      }
      return child;
    });
    return changed ? { ...stack, children } : stack;
  }

  if (root.id === id) {
    const next = update(root);
    // The root is a stack by definition; an update that returns anything else
    // would decapitate the document, so it is refused rather than applied.
    return isStack(next) ? (touch(next) as StackNode) : root;
  }
  return rewrite(root);
}

/** Rewrites several nodes in one pass, so a multi-select edit is one new tree. */
export function updateNodes(
  root: StackNode,
  ids: readonly string[],
  update: (node: DrawingNode) => DrawingNode,
): StackNode {
  const targets = new Set(ids);
  if (targets.size === 0) return root;

  function rewrite(stack: StackNode): StackNode {
    let changed = false;
    const children = stack.children.map((child) => {
      let next = child;
      if (targets.has(child.id)) {
        next = touch(update(child));
        changed = true;
      }
      if (isStack(next)) {
        const rewritten = rewrite(next);
        if (rewritten !== next) {
          next = rewritten;
          changed = true;
        }
      }
      return next;
    });
    return changed ? { ...stack, children } : stack;
  }

  return rewrite(root);
}

/** Stamps `modifiedAt`. Every rewrite goes through it so the timestamp cannot be forgotten. */
function touch(node: DrawingNode): DrawingNode {
  return { ...node, modifiedAt: new Date().toISOString() };
}

/**
 * Inserts a node into a stack.
 *
 * `index` counts from the top, because `children` does. Omitting it puts the
 * node on top, which is where a newly created layer belongs.
 */
export function insertNode(
  root: StackNode,
  node: DrawingNode,
  opts: { parentId?: string; index?: number } = {},
): StackNode {
  const parentId = opts.parentId ?? root.id;
  const placed: DrawingNode = { ...node, parentId };

  function rewrite(stack: StackNode): StackNode {
    if (stack.id === parentId) {
      const children = [...stack.children];
      const at = opts.index === undefined ? 0 : Math.max(0, Math.min(children.length, opts.index));
      children.splice(at, 0, placed);
      return { ...stack, children };
    }
    let changed = false;
    const children = stack.children.map((child) => {
      if (!isStack(child)) return child;
      const next = rewrite(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...stack, children } : stack;
  }

  return rewrite(root);
}

export function removeNode(root: StackNode, id: string): StackNode {
  function rewrite(stack: StackNode): StackNode {
    let changed = false;
    const children: DrawingNode[] = [];
    for (const child of stack.children) {
      if (child.id === id) {
        changed = true;
        continue;
      }
      if (isStack(child)) {
        const next = rewrite(child);
        if (next !== child) changed = true;
        children.push(next);
      } else {
        children.push(child);
      }
    }
    return changed ? { ...stack, children } : stack;
  }
  return rewrite(root);
}

/**
 * Moves a node to a new parent and position.
 *
 * Refuses to move a stack into its own subtree — that detaches the whole branch
 * from the tree and loses it, which is the one way a drag in the layers panel
 * could destroy work.
 */
export function moveNode(
  root: StackNode,
  id: string,
  target: { parentId: string; index: number },
): StackNode {
  if (id === root.id) return root;
  if (isSelfOrDescendant(root, id, target.parentId)) return root;

  const node = findNode(root, id);
  if (!node) return root;

  const currentParent = findParent(root, id);
  const currentIndex = currentParent?.children.findIndex((c) => c.id === id) ?? -1;

  const detached = removeNode(root, id);
  // Removing from earlier in the same parent shifts every later position down one.
  const sameParent = currentParent?.id === target.parentId;
  const index = sameParent && currentIndex >= 0 && currentIndex < target.index
    ? target.index - 1
    : target.index;

  return insertNode(detached, node, { parentId: target.parentId, index });
}

/** Moves a node within its own parent, clamped to the ends. */
export function reorderWithinParent(root: StackNode, id: string, delta: number): StackNode {
  const parent = findParent(root, id);
  if (!parent) return root;
  const from = parent.children.findIndex((c) => c.id === id);
  if (from < 0) return root;
  const to = Math.max(0, Math.min(parent.children.length - 1, from + delta));
  if (to === from) return root;
  return updateNode(root, parent.id, (stack) => {
    const children = [...(stack as StackNode).children];
    const [moved] = children.splice(from, 1);
    children.splice(to, 0, moved);
    return { ...(stack as StackNode), children };
  });
}

/**
 * Wraps nodes in a new group, in place of the topmost of them.
 *
 * The group lands where the highest selected node was rather than on top of the
 * document, so grouping does not also reorder — the two are separate actions
 * and conflating them makes the first one unusable.
 */
export function groupNodes(root: StackNode, ids: readonly string[], group: StackNode): StackNode {
  const selected = ids
    .map((id) => findNode(root, id))
    .filter((n): n is DrawingNode => n !== null);
  if (selected.length === 0) return root;

  const parent = findParent(root, selected[0].id) ?? root;
  // Only siblings can be grouped without changing what covers what.
  const siblings = selected.filter((n) => parent.children.some((c) => c.id === n.id));
  if (siblings.length === 0) return root;

  const index = Math.min(...siblings.map((n) => parent.children.findIndex((c) => c.id === n.id)));

  let next = root;
  for (const node of siblings) next = removeNode(next, node.id);

  const ordered = parent.children
    .filter((c) => siblings.some((s) => s.id === c.id))
    .map((c) => ({ ...c, parentId: group.id }));

  return insertNode(next, { ...group, children: ordered }, { parentId: parent.id, index });
}

/** Replaces a group with its children, at the group's own position. */
export function ungroupNode(root: StackNode, id: string): StackNode {
  const group = findNode(root, id);
  if (!group || !isStack(group)) return root;
  const parent = findParent(root, id);
  if (!parent) return root;
  const index = parent.children.findIndex((c) => c.id === id);

  return updateNode(root, parent.id, (stack) => {
    const children = [...(stack as StackNode).children];
    children.splice(index, 1, ...group.children.map((c) => ({ ...c, parentId: parent.id })));
    return { ...(stack as StackNode), children };
  });
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/**
 * Rebuilds `parentId` across the tree from `children`.
 *
 * Run on load and after any structural edit that did not go through the helpers
 * above, so the two never disagree. Returns the same object when nothing was
 * wrong, which keeps it cheap to call defensively.
 */
export function normalizeTree(root: StackNode): StackNode {
  function rewrite(stack: StackNode, parentId: string | null): StackNode {
    let changed = stack.parentId !== parentId;
    const children = stack.children.map((child) => {
      const withParent = child.parentId === stack.id ? child : { ...child, parentId: stack.id };
      if (withParent !== child) changed = true;
      if (isStack(withParent)) {
        const next = rewrite(withParent, stack.id);
        if (next !== withParent) changed = true;
        return next;
      }
      return withParent;
    });
    return changed ? { ...stack, parentId, children } : stack;
  }
  return rewrite(root, null);
}

/**
 * A node's own content extent, ignoring its transform.
 *
 * `symbols` is needed only for an instance, whose content lives elsewhere.
 * Called without it an instance falls back to its cached `bounds` — the value
 * `refreshBounds` last computed *with* the table — which is right for a reader
 * that has just parsed a document and wrong only for an instance whose symbol
 * changed since, which is why every caller that has a document passes the table.
 */
export function contentBounds(node: DrawingNode, symbols?: SymbolTable): Rect | null {
  switch (node.type) {
    case 'raster':
      return { x: node.source.x, y: node.source.y, width: node.source.width, height: node.source.height };
    case 'text':
      return { ...node.box };
    case 'vector':
      return unionRects(node.objects.filter((o) => o.visible).map(vectorObjectBounds));
    case 'stack':
      return unionRects(node.children.map((child) => contentBounds(child, symbols)));
    case 'instance': {
      const symbol = symbols?.get(node.symbolId);
      if (!symbol) return node.bounds.width > 0 && node.bounds.height > 0 ? { ...node.bounds } : null;
      const inner = contentBounds(symbol.content, symbols);
      if (!inner) return null;
      // The symbol's own content sits in the symbol's coordinates; the
      // instance's transform is applied by whoever composes it, so only the
      // *content's* transform belongs here.
      return transformedRectBounds(inner, symbol.content.transform);
    }
  }
}

/**
 * Recomputes every `bounds` in the tree.
 *
 * `bounds` is cached derived state — redesign §1 asks each object to carry it,
 * and a value stored on a node is a value that can go stale. Rather than
 * maintaining it at every edit site, the editor recomputes the tree here on
 * save and on load, which is where a wrong answer would actually be observed:
 * the OpenRaster writer sizes each layer's PNG from it.
 */
export function refreshBounds(root: StackNode, symbols?: SymbolTable): StackNode {
  function rewrite(node: DrawingNode): DrawingNode {
    const withChildren: DrawingNode = isStack(node)
      ? { ...node, children: node.children.map(rewrite) }
      : node;
    const bounds = contentBounds(withChildren, symbols) ?? { x: 0, y: 0, width: 0, height: 0 };
    return { ...withChildren, bounds };
  }
  return rewrite(root) as StackNode;
}

/**
 * The transform a node inherits from its groups, outermost first.
 *
 * A node's own transform is *not* included — callers compose it themselves,
 * because the two are needed separately: hit testing wants the full chain,
 * while moving a group wants to change only its own.
 */
export function inheritedTransform(root: StackNode, id: string): Transform2D {
  return ancestorsOf(root, id).reduce<Transform2D>(
    (acc, ancestor) => multiplyTransform(acc, ancestor.transform),
    { ...IDENTITY },
  );
}

/**
 * A node's extent in canvas coordinates, with every enclosing group's transform
 * applied.
 *
 * This is what a selection frame and a click test have to use. Reading
 * `node.bounds` directly would be right only for a node that is not inside a
 * moved group — which is the case often enough to look correct in testing and
 * wrong the moment anyone drags a group.
 */
export function nodeCanvasBounds(root: StackNode, node: DrawingNode, symbols?: SymbolTable): Rect | null {
  const local = contentBounds(node, symbols);
  if (!local) return null;
  const combined = multiplyTransform(inheritedTransform(root, node.id), node.transform);
  return transformedRectBounds(local, combined);
}

/** The whole document's drawn extent, or null when nothing is drawn. */
export function documentContentBounds(doc: DrawingDocument): Rect | null {
  const symbols = symbolTable(doc);
  const rects: (Rect | null)[] = [];
  visitNodes(doc.root, (node) => {
    if (node.type === 'stack') return;
    if (!isEffectivelyVisible(doc.root, node.id)) return;
    rects.push(nodeCanvasBounds(doc.root, node, symbols));
  });
  return unionRects(rects);
}

/** Whether anything at all would be drawn — what the export dialog gates on. */
export function isDocumentEmpty(doc: DrawingDocument): boolean {
  let empty = true;
  visitNodes(doc.root, (node) => {
    if (node.type === 'raster' || node.type === 'text' || node.type === 'instance') empty = false;
    if (node.type === 'vector' && node.objects.length > 0) empty = false;
  });
  return empty;
}

/** The raster layers a brush can paint into, topmost first. */
export function rasterLayers(root: StackNode): DrawingNode[] {
  return flattenTree(root).filter((f) => f.node.type === 'raster').map((f) => f.node);
}

/**
 * Every `PathObject` in the document, with the layer holding it.
 *
 * Text on a path names a path by id and the path can be in any vector layer, so
 * binding one means listing them all — there is no "paths" collection to look
 * in, deliberately: a path bound to a caption is an ordinary path that stays
 * selectable and editable like any other.
 */
export function findPathObject(
  root: StackNode,
  pathId: string,
): { layerId: string; object: import('./types').PathObject } | null {
  let found: { layerId: string; object: import('./types').PathObject } | null = null;
  visitNodes(root, (node) => {
    if (found || node.type !== 'vector') return;
    for (const object of node.objects) {
      if (object.id === pathId && object.kind === 'path') {
        found = { layerId: node.id, object };
        return;
      }
    }
  });
  return found;
}
