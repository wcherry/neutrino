/**
 * Reading and writing the stored drawing body.
 *
 * The parser is deliberately asymmetric, and that asymmetry is what these tests
 * are about. *Within* a version 2 document it is forgiving — a missing blend
 * mode reads as normal, a nonsense opacity clamps — because the body has been
 * through a network and a cipher, and one bad number should not cost the whole
 * drawing. *Across* versions it refuses: anything that is not version 2 returns
 * null rather than being guessed at, and the editor opens a new document (for
 * an empty body) or refuses to open at all (for bytes that are something else).
 */

import { describe, it, expect } from 'vitest';

import {
  createDocument,
  createMask,
  createRasterLayer,
  createRect,
  createStack,
  createTextLayer,
  createVectorLayer,
} from '../../app/(apps)/drawing/editor/document/factory';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { addNode, addObjects, setNodeProps } from '../../app/(apps)/drawing/editor/document/edits';
import { findNode, flattenTree, normalizeTree } from '../../app/(apps)/drawing/editor/document/tree';
import type { StackNode, TextLayerNode, VectorLayerNode } from '../../app/(apps)/drawing/editor/types';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function rasterSource(overrides: Record<string, number> = {}) {
  return { dataUrl: PIXEL, width: 10, height: 10, x: 0, y: 0, ...overrides };
}

/** A document exercising every node type, a group, a mask and a blend mode. */
function richDocument() {
  const base = createDocument({ title: 'Everything', canvas: { width: 640, height: 480, dpi: 144 } });
  const vector = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;

  let doc = addObjects(base, vector.id, [
    createRect({ x: 10, y: 20, width: 30, height: 40 }, { fill: '#ff0000', strokeStyle: 'dashed' }),
  ]);

  const text = createTextLayer({ x: 5, y: 5, width: 200, height: 60 }, 'Hello\nthere');
  doc = addNode(doc, text);

  const raster = createRasterLayer(rasterSource({ x: 7, y: 9 }), 'Photo');
  doc = addNode(doc, raster);
  doc = setNodeProps(doc, raster.id, {
    blendMode: 'multiply',
    opacity: 0.4,
    mask: createMask('transparency', rasterSource()),
  });

  const group = createStack('Group');
  group.children = [createVectorLayer('Inside')];
  doc = { ...doc, root: normalizeTree({ ...doc.root, children: [group, ...doc.root.children] }) };

  return { doc, ids: { vector: vector.id, text: text.id, raster: raster.id, group: group.id } };
}

describe('round trip', () => {
  it('survives every node type, a group, a mask and a blend mode', () => {
    const { doc, ids } = richDocument();
    const restored = parseDocument(serializeDocument(doc))!;

    expect(restored).not.toBeNull();
    expect(restored.canvas).toEqual(doc.canvas);
    expect(restored.metadata.title).toBe('Everything');

    const raster = findNode(restored.root, ids.raster)!;
    expect(raster.type).toBe('raster');
    expect(raster.blendMode).toBe('multiply');
    expect(raster.opacity).toBe(0.4);
    expect(raster.mask?.kind).toBe('transparency');
    expect(raster.mask?.source?.dataUrl).toBe(PIXEL);

    const text = findNode(restored.root, ids.text) as TextLayerNode;
    expect(text.text).toBe('Hello\nthere');
    expect(text.box).toEqual({ x: 5, y: 5, width: 200, height: 60 });

    const vector = findNode(restored.root, ids.vector) as VectorLayerNode;
    expect(vector.objects).toHaveLength(1);
    expect(vector.objects[0].style.fill).toBe('#ff0000');
    expect(vector.objects[0].style.strokeStyle).toBe('dashed');

    const group = findNode(restored.root, ids.group) as StackNode;
    expect(group.children.map((c) => c.name)).toEqual(['Inside']);
  });

  it('keeps the layer order', () => {
    const { doc } = richDocument();
    const before = flattenTree(doc.root).map((f) => f.node.name);
    const after = flattenTree(parseDocument(serializeDocument(doc))!.root).map((f) => f.node.name);
    expect(after).toEqual(before);
  });

  it('rebuilds parentId from the structure rather than trusting the stored value', () => {
    const { doc, ids } = richDocument();
    const body = JSON.parse(serializeDocument(doc));

    // Corrupt one stored parent, as a hand edit or a foreign writer might.
    body.root.children[0].parentId = 'nonsense';
    const restored = parseDocument(JSON.stringify(body))!;

    expect(findNode(restored.root, ids.group)!.parentId).toBe(restored.root.id);
  });

  it('stamps the writing application and a fresh modification time', () => {
    const doc = createDocument({ title: 'Sketch' });
    const restored = parseDocument(serializeDocument(doc))!;

    expect(restored.metadata.application.name).toBe('Neutrino Drawing');
    expect(Date.parse(restored.metadata.modifiedAt)).not.toBeNaN();
    expect(restored.metadata.createdAt).toBe(doc.metadata.createdAt);
  });

  it('keeps guides, grid and viewport', () => {
    const doc: ReturnType<typeof createDocument> = {
      ...createDocument(),
      guides: [{ id: 'g1', orientation: 'vertical', position: 120 }],
      viewport: { x: -40, y: 12, scale: 2.5 },
    };
    doc.grid = { ...doc.grid, size: 32, snap: false, visible: false };

    const restored = parseDocument(serializeDocument(doc))!;
    expect(restored.guides).toEqual(doc.guides);
    expect(restored.grid).toEqual(doc.grid);
    expect(restored.viewport).toEqual(doc.viewport);
  });
});

describe('rejecting what is not a drawing', () => {
  it('returns null for an empty body', () => {
    expect(parseDocument('')).toBeNull();
    expect(parseDocument('   ')).toBeNull();
  });

  it('returns null for text that is not JSON', () => {
    expect(parseDocument('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
    expect(parseDocument('not json at all')).toBeNull();
  });

  it('returns null for JSON that is not a version 2 document', () => {
    // The flat body that predated this model. There is no conversion path and
    // there should not be one: guessing at another format is how a drawing gets
    // silently replaced by an approximation of itself.
    expect(parseDocument('{"version":1,"shapes":[],"layers":[]}')).toBeNull();
    expect(parseDocument('{"version":3,"root":{}}')).toBeNull();
    expect(parseDocument('{"pages":[]}')).toBeNull();
    expect(parseDocument('[]')).toBeNull();
  });
});

describe('repairing a damaged version 2 body', () => {
  it('clamps an out-of-range opacity instead of dropping the layer', () => {
    const doc = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const body = JSON.parse(serializeDocument(addNode(doc, layer)));
    body.root.children[0].opacity = 42;

    const restored = parseDocument(JSON.stringify(body))!;
    expect(findNode(restored.root, layer.id)!.opacity).toBe(1);
  });

  it('reads an unknown blend mode as normal', () => {
    const doc = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const body = JSON.parse(serializeDocument(addNode(doc, layer)));
    body.root.children[0].blendMode = 'plasma';

    const restored = parseDocument(JSON.stringify(body))!;
    expect(findNode(restored.root, layer.id)!.blendMode).toBe('normal');
  });

  it('drops a node whose type it does not know, keeping the rest', () => {
    const doc = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const body = JSON.parse(serializeDocument(addNode(doc, layer)));
    body.root.children.unshift({ id: 'x', type: 'hologram', name: 'From the future' });

    const restored = parseDocument(JSON.stringify(body))!;
    expect(findNode(restored.root, 'x')).toBeNull();
    expect(findNode(restored.root, layer.id)).not.toBeNull();
  });

  it('drops a raster source that is not an embedded image', () => {
    const doc = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const body = JSON.parse(serializeDocument(addNode(doc, layer)));
    // A document is not a place to fetch things from: an arbitrary URL here
    // would reach an `<img>` and phone home when the drawing is opened.
    body.root.children[0].source.dataUrl = 'https://example.com/tracker.png';

    const restored = parseDocument(JSON.stringify(body))!;
    expect(findNode(restored.root, layer.id)).toBeNull();
  });

  it('recomputes bounds rather than trusting what was stored', () => {
    const doc = createDocument();
    const layer = createRasterLayer(rasterSource({ x: 5, y: 5, width: 20, height: 20 }), 'Photo');
    const body = JSON.parse(serializeDocument(addNode(doc, layer)));
    body.root.children[0].bounds = { x: -999, y: -999, width: 1, height: 1 };

    const restored = parseDocument(JSON.stringify(body))!;
    expect(findNode(restored.root, layer.id)!.bounds).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it('falls back to a default canvas when the stored one is nonsense', () => {
    const body = JSON.parse(serializeDocument(createDocument()));
    body.canvas = { width: 0, height: -5, dpi: 'lots' };

    const restored = parseDocument(JSON.stringify(body))!;
    expect(restored.canvas.width).toBe(1);
    expect(restored.canvas.height).toBe(1);
    expect(restored.canvas.dpi).toBe(96);
  });

  it('keeps a transparent canvas transparent rather than defaulting it to white', () => {
    const doc = { ...createDocument(), canvas: { ...createDocument().canvas, background: null } };
    expect(parseDocument(serializeDocument(doc))!.canvas.background).toBeNull();
  });
});
