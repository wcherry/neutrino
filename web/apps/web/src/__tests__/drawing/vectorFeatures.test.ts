/**
 * Text on a path, reusable symbols and the pixel selection — the parts of
 * phases 4 and 5 that have to agree across three places at once.
 *
 * Each of these is a Neutrino feature with an SVG counterpart and an OpenRaster
 * fallback, which is the redesign's central rule, so what is tested here is the
 * *agreement*: the model, the SVG the writer emits and the round trip through
 * `parseDocument` must all say the same thing. A feature that renders correctly
 * and exports as nothing is the failure mode this catches.
 */

import { describe, it, expect } from 'vitest';

import {
  createDocument,
  createPath,
  createStack,
  createSymbol,
  createInstance,
  createTextLayer,
  createVectorLayer,
} from '../../app/(apps)/drawing/editor/document/factory';
import {
  addNode,
  addObjects,
  addSymbol,
  detachInstance,
  removeSymbol,
  setSelection,
  setTextPath,
  patchTextPath,
} from '../../app/(apps)/drawing/editor/document/edits';
import { findNode, flattenTree, findPathObject, normalizeTree } from '../../app/(apps)/drawing/editor/document/tree';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { documentToSvg } from '../../app/(apps)/drawing/editor/render/documentSvg';
import {
  combineSelections,
  isSelectionEmpty,
  selectionBounds,
  selectionContains,
} from '../../app/(apps)/drawing/editor/document/selection';
import type { DrawingDocument, PathObject } from '../../app/(apps)/drawing/editor/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A document with one path and one text layer bound to it. */
function withTextOnPath(): { doc: DrawingDocument; pathId: string; textId: string } {
  const base = createDocument({ canvas: { width: 400, height: 200 } });
  const layer = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;
  const path = createPath(
    [{ x: 0, y: 100, out: { x: 130, y: 0 } }, { x: 400, y: 100, in: { x: 270, y: 0 } }],
    { fill: 'none', stroke: '#000000', strokeWidth: 1 },
  );

  const withPath = addObjects(base, layer.id, [path]);
  const text = createTextLayer({ x: 0, y: 0, width: 200, height: 40 }, 'Around the bend');
  const withText = addNode(withPath, text);

  return {
    doc: setTextPath(withText, text.id, {
      pathId: path.id,
      startOffset: 10,
      align: 'start',
      baselineOffset: -4,
      side: 'left',
    }),
    pathId: path.id,
    textId: text.id,
  };
}

// ---------------------------------------------------------------------------
// Text on a path
// ---------------------------------------------------------------------------

describe('text on a path', () => {
  it('references a path that stays an ordinary editable object', () => {
    const { doc, pathId } = withTextOnPath();

    // The whole design: the curve is not private geometry on the text layer,
    // it is a path any tool can select, move and reshape.
    const found = findPathObject(doc.root, pathId);
    expect(found).not.toBeNull();
    expect(found!.object.kind).toBe('path');
  });

  it('survives a save and reload with every field intact', () => {
    const { doc, textId, pathId } = withTextOnPath();
    const reloaded = parseDocument(serializeDocument(doc))!;
    const text = findNode(reloaded.root, textId)!;

    if (text.type !== 'text') throw new Error('expected a text layer');
    expect(text.textPath).toEqual({
      pathId, startOffset: 10, align: 'start', baselineOffset: -4, side: 'left',
    });
  });

  it('drops a binding whose target id is missing on the way in', () => {
    // A binding with no target is not a binding; keeping it would leave a
    // dangling reference the renderer has to guard on every frame.
    const { doc, textId } = withTextOnPath();
    const damaged = JSON.parse(serializeDocument(doc));
    const walk = (node: { id: string; textPath?: unknown; children?: unknown[] }): void => {
      if (node.id === textId) node.textPath = { startOffset: 50 };
      (node.children as typeof node[] | undefined)?.forEach(walk);
    };
    walk(damaged.root);

    const reloaded = parseDocument(JSON.stringify(damaged))!;
    const text = findNode(reloaded.root, textId)!;
    if (text.type !== 'text') throw new Error('expected a text layer');
    expect(text.textPath).toBeUndefined();
  });

  it('exports as SVG’s own textPath, referencing the path by id', () => {
    const { doc, pathId } = withTextOnPath();
    const svg = documentToSvg(doc);

    // Not baked-in geometry: reshape the path in any SVG editor and the text
    // re-flows, which is the property `<textPath href>` exists for.
    expect(svg).toContain(`<textPath href="#${pathId}"`);
    expect(svg).toContain('startOffset="10%"');
    // The path itself is in the output, so the reference resolves.
    expect(svg).toContain(`id="${pathId}"`);
  });

  it('writes the curve into defs when the path itself is hidden', () => {
    const { doc, pathId } = withTextOnPath();
    const layer = flattenTree(doc.root).find((f) => f.node.type === 'vector')!.node;
    if (layer.type !== 'vector') throw new Error('expected a vector layer');

    const hidden: DrawingDocument = {
      ...doc,
      root: normalizeTree({
        ...doc.root,
        children: doc.root.children.map((child) => (
          child.id === layer.id
            ? { ...layer, objects: layer.objects.map((o) => ({ ...o, visible: false })) }
            : child
        )),
      }),
    };

    const svg = documentToSvg(hidden);
    // A `<textPath>` pointing at nothing renders as nothing in every conforming
    // viewer, so a hidden guide must not take the caption with it.
    expect(svg).toContain(`<textPath href="#${pathId}"`);
    expect(svg).toContain(`<path id="${pathId}"`);
    // Exactly one element carries the id — a duplicate renders unpredictably.
    expect(svg.match(new RegExp(`id="${pathId}"`, 'g'))).toHaveLength(1);
  });

  it('changes one field of a binding without disturbing the rest', () => {
    const { doc, textId, pathId } = withTextOnPath();
    const moved = patchTextPath(doc, textId, { startOffset: 75 });
    const text = findNode(moved.root, textId)!;

    if (text.type !== 'text') throw new Error('expected a text layer');
    expect(text.textPath).toMatchObject({ pathId, startOffset: 75, baselineOffset: -4 });
  });

  it('unbinds back to box layout', () => {
    const { doc, textId } = withTextOnPath();
    const text = findNode(setTextPath(doc, textId, undefined).root, textId)!;

    if (text.type !== 'text') throw new Error('expected a text layer');
    expect(text.textPath).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/** A document with one symbol and two instances of it. */
function withSymbol() {
  const base = createDocument();
  const content = createVectorLayer('Icon', {
    objects: [createPath([{ x: 0, y: 0 }, { x: 20, y: 20 }], { stroke: '#000000', strokeWidth: 2 })],
  });
  const symbol = createSymbol(content, 'Icon');

  let doc = addSymbol(base, symbol);
  const first = createInstance(symbol, { transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 10 } });
  const second = createInstance(symbol, { transform: { a: 1, b: 0, c: 0, d: 1, e: 90, f: 10 } });
  doc = addNode(addNode(doc, first), second);

  return { doc, symbol, first, second };
}

describe('reusable symbols', () => {
  it('stores the content once and references it by id', () => {
    const { doc, symbol, first, second } = withSymbol();

    // "Stored once and referenced by UUID", per redesign §4.
    expect(doc.symbols).toHaveLength(1);
    expect(findNode(doc.root, first.id)).toMatchObject({ type: 'instance', symbolId: symbol.id });
    expect(findNode(doc.root, second.id)).toMatchObject({ type: 'instance', symbolId: symbol.id });
  });

  it('resets the definition’s own transform, so an instance is placed once', () => {
    const content = createVectorLayer('Icon', { transform: { a: 1, b: 0, c: 0, d: 1, e: 500, f: 500 } });
    const symbol = createSymbol(content);
    // Keeping the source node's position would offset every instance by it on
    // top of the instance's own transform.
    expect(symbol.content.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  it('gives an instance the extent of its symbol’s content', () => {
    const { doc, first } = withSymbol();
    const instance = findNode(doc.root, first.id)!;
    const reloaded = parseDocument(serializeDocument({ ...doc, root: doc.root }))!;
    const restored = findNode(reloaded.root, instance.id)!;

    // Bounds are refreshed after the symbols are known; doing it the other way
    // round leaves every instance with a zero-sized box and no selection frame.
    expect(restored.bounds.width).toBeGreaterThan(0);
    expect(restored.bounds.height).toBeGreaterThan(0);
  });

  it('survives a save and reload', () => {
    const { doc, symbol } = withSymbol();
    const reloaded = parseDocument(serializeDocument(doc))!;

    expect(reloaded.symbols).toHaveLength(1);
    expect(reloaded.symbols![0].id).toBe(symbol.id);
    expect(flattenTree(reloaded.root).filter((f) => f.node.type === 'instance')).toHaveLength(2);
  });

  it('exports as a symbol plus a use per instance', () => {
    const { doc } = withSymbol();
    const svg = documentToSvg(doc);

    // SVG has the same idea, so this is a translation rather than a flattening:
    // the content travels once and both instances reference it.
    expect(svg.match(/<symbol /g)).toHaveLength(1);
    expect(svg.match(/<use /g)).toHaveLength(2);
  });

  it('detaches one instance into an ordinary copy, leaving the other alone', () => {
    const { doc, first, second } = withSymbol();
    const detached = detachInstance(doc, first.id);

    expect(findNode(detached.root, first.id)!.type).toBe('vector');
    // The other instance is untouched and the definition stays.
    expect(findNode(detached.root, second.id)!.type).toBe('instance');
    expect(detached.symbols).toHaveLength(1);
  });

  it('materialises every instance when the symbol is removed', () => {
    const { doc, symbol, first, second } = withSymbol();
    const without = removeSymbol(doc, symbol.id);

    // Deleting the definition and leaving the instances would empty them —
    // rows in the panel that draw nothing and cannot be repaired.
    expect(without.symbols).toHaveLength(0);
    expect(findNode(without.root, first.id)!.type).toBe('vector');
    expect(findNode(without.root, second.id)!.type).toBe('vector');
  });

  it('keeps an instance’s own placement when it is detached', () => {
    const { doc, first } = withSymbol();
    const detached = detachInstance(doc, first.id);
    expect(findNode(detached.root, first.id)!.transform.e).toBe(10);
  });

  it('drops an instance with no symbol id on the way in', () => {
    const base = createDocument();
    const orphan = { ...createStack('Orphan'), type: 'instance', symbolId: '' };
    const body = JSON.stringify({
      ...base,
      root: { ...base.root, children: [orphan, ...base.root.children] },
    });

    const reloaded = parseDocument(body)!;
    // An instance of nothing draws nothing and cannot be given a symbol from
    // the UI, so it is dropped rather than kept as an unrepairable row.
    expect(flattenTree(reloaded.root).some((f) => f.node.type === 'instance')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pixel selection
// ---------------------------------------------------------------------------

describe('the active selection', () => {
  const canvas = { width: 200, height: 100 };

  it('reports the area it covers, clipped to the canvas', () => {
    expect(selectionBounds({ kind: 'rect', rect: { x: 10, y: 10, width: 50, height: 20 } }, canvas))
      .toEqual({ x: 10, y: 10, width: 50, height: 20 });

    // Half off the right edge: the canvas is the frame, and a brush cannot
    // paint past it.
    expect(selectionBounds({ kind: 'rect', rect: { x: 180, y: 0, width: 100, height: 50 } }, canvas))
      .toEqual({ x: 180, y: 0, width: 20, height: 50 });

    expect(selectionBounds({ kind: 'rect', rect: { x: 900, y: 0, width: 10, height: 10 } }, canvas))
      .toBeNull();
  });

  it('knows what an ellipse contains, rather than just its box', () => {
    const shape = { kind: 'ellipse' as const, rect: { x: 0, y: 0, width: 100, height: 100 } };
    expect(selectionContains(shape, { x: 50, y: 50 })).toBe(true);
    // A corner of the bounding box is outside the ellipse itself.
    expect(selectionContains(shape, { x: 2, y: 2 })).toBe(false);
  });

  it('knows what a lasso contains', () => {
    const shape = {
      kind: 'lasso' as const,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    };
    expect(selectionContains(shape, { x: 80, y: 40 })).toBe(true);
    expect(selectionContains(shape, { x: 10, y: 90 })).toBe(false);
  });

  it('treats a degenerate shape as nothing selected', () => {
    expect(isSelectionEmpty(undefined, canvas)).toBe(true);
    expect(isSelectionEmpty({ kind: 'rect', rect: { x: 0, y: 0, width: 0, height: 0 } }, canvas)).toBe(true);
    expect(isSelectionEmpty({ kind: 'lasso', points: [{ x: 0, y: 0 }] }, canvas)).toBe(true);
  });

  it('intersects two rectangles exactly, and defers everything else', () => {
    const a = { kind: 'rect' as const, rect: { x: 0, y: 0, width: 100, height: 100 } };
    const b = { kind: 'rect' as const, rect: { x: 50, y: 50, width: 100, height: 100 } };

    // The one combination common enough to be worth not rasterising — it is
    // how you crop a marquee.
    const result = combineSelections(a, b, 'intersect');
    expect(result).toEqual({ shape: { kind: 'rect', rect: { x: 50, y: 50, width: 50, height: 50 } } });

    // A union of a rectangle and a lasso is neither, so it goes to the caller
    // to rasterise — which needs a canvas and does not belong in a pure module.
    const mixed = combineSelections(a, { kind: 'lasso', points: [] }, 'add');
    expect(mixed).toHaveProperty('rasterize');
  });

  it('is stored on the document and comes back from a reload', () => {
    const doc = setSelection(createDocument(), { kind: 'rect', rect: { x: 5, y: 6, width: 7, height: 8 } });
    const reloaded = parseDocument(serializeDocument(doc))!;

    expect(reloaded.selection).toEqual({ kind: 'rect', rect: { x: 5, y: 6, width: 7, height: 8 } });
  });

  it('is dropped entirely rather than stored as an empty value', () => {
    const doc = setSelection(createDocument(), { kind: 'rect', rect: { x: 0, y: 0, width: 5, height: 5 } });
    const cleared = setSelection(doc, undefined);

    expect('selection' in cleared).toBe(false);
    expect(parseDocument(serializeDocument(cleared))!.selection).toBeUndefined();
  });

  it('reads an unrecognised stored selection as nothing selected', () => {
    // The only safe guess: a selection restored wrongly silently confines the
    // next brush stroke to the wrong part of the canvas.
    const body = JSON.stringify({ ...createDocument(), selection: { kind: 'polygon', foo: 1 } });
    expect(parseDocument(body)!.selection).toBeUndefined();
  });
});

/** Kept honest against the path helper the binding UI lists options from. */
describe('finding a path to bind to', () => {
  it('finds a path in any vector layer, and nothing for a non-path id', () => {
    const { doc, pathId } = withTextOnPath();
    expect(findPathObject(doc.root, pathId)?.object.id).toBe(pathId);
    expect(findPathObject(doc.root, 'nope')).toBeNull();
  });

  it('does not mistake another object kind for a path', () => {
    const base = createDocument();
    const layer = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;
    const path: PathObject = createPath([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    const doc = addObjects(base, layer.id, [path]);

    expect(findPathObject(doc.root, layer.id)).toBeNull();
  });
});
