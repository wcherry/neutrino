/**
 * Masks — redesign phase 4's non-destructive half.
 *
 * Four kinds are modelled and one of them behaves differently from the rest: a
 * **clipping** mask has no channel of its own and takes its shape from the layer
 * below, which is the only mask the compositor cannot resolve by looking at the
 * node alone. Everything here is about that asymmetry holding in all three
 * places it has to — the model, the SVG writer, and the rule about which layer
 * a clipped layer is clipped *to*.
 *
 * The canvas compositor itself is not exercised here (jsdom has no 2D context);
 * `openRaster.test.ts` covers the geometry side of rasterising a masked layer,
 * and the SVG writer is the one emitter that can be read back as text.
 */

import { describe, it, expect } from 'vitest';

import {
  createDocument,
  createMask,
  createRasterLayer,
  createVectorLayer,
  createRect,
} from '../../app/(apps)/drawing/editor/document/factory';
import { addNode, patchNodeMask, setNodeMask, setNodeProps } from '../../app/(apps)/drawing/editor/document/edits';
import { findNode, normalizeTree } from '../../app/(apps)/drawing/editor/document/tree';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { documentToSvg } from '../../app/(apps)/drawing/editor/render/documentSvg';
import type { DrawingDocument, StackNode } from '../../app/(apps)/drawing/editor/types';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function channel(overrides: Record<string, number> = {}) {
  return { dataUrl: PIXEL, width: 100, height: 100, x: 0, y: 0, ...overrides };
}

/** A base layer with a shape on it, and a layer above clipped to it. */
function clippedStack(): { doc: DrawingDocument; baseId: string; clippedId: string } {
  const document_ = createDocument({ canvas: { width: 200, height: 200 } });
  const base = createVectorLayer('Base', {
    objects: [createRect({ x: 0, y: 0, width: 100, height: 100 }, { fill: '#000000' })],
  });
  const clipped = createVectorLayer('Clipped', {
    objects: [createRect({ x: 0, y: 0, width: 200, height: 200 }, { fill: '#ff0000' })],
    mask: createMask('clipping'),
  });

  // `children[0]` is topmost, so the clipped layer comes first and the base
  // sits under it.
  const root: StackNode = normalizeTree({ ...document_.root, children: [clipped, base] });
  return { doc: { ...document_, root }, baseId: base.id, clippedId: clipped.id };
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

describe('a mask on a layer', () => {
  it('round-trips through a save with its kind, flags and channel', () => {
    const base = createDocument();
    const layer = createRasterLayer(channel(), 'Photo');
    const withLayer = addNode(base, layer);
    const doc = setNodeProps(withLayer, layer.id, {
      mask: { ...createMask('transparency', channel({ x: 3, y: 4 })), inverted: true },
    });

    const restored = findNode(parseDocument(serializeDocument(doc))!.root, layer.id)!;

    expect(restored.mask).toMatchObject({ kind: 'transparency', inverted: true, enabled: true });
    expect(restored.mask?.source).toMatchObject({ x: 3, y: 4, width: 100, height: 100 });
  });

  it('has no channel when it is a clipping mask', () => {
    // The one kind with nothing of its own to store: its shape is the layer
    // below, which is why the compositor has to resolve it in the stack walk.
    expect(createMask('clipping').source).toBeNull();
  });

  it('reads an unknown kind as an ordinary layer mask', () => {
    const base = createDocument();
    const layer = createRasterLayer(channel(), 'Photo');
    const doc = setNodeProps(addNode(base, layer), layer.id, { mask: createMask('layer', channel()) });

    const body = JSON.parse(serializeDocument(doc));
    body.root.children[0].mask.kind = 'wormhole';
    const restored = findNode(parseDocument(JSON.stringify(body))!.root, layer.id)!;

    expect(restored.mask?.kind).toBe('layer');
  });

  it('patches flags without touching the channel', () => {
    const base = createDocument();
    const layer = createRasterLayer(channel(), 'Photo');
    const source = channel({ x: 9 });
    const doc = setNodeProps(addNode(base, layer), layer.id, { mask: createMask('layer', source) });

    const toggled = patchNodeMask(doc, layer.id, { enabled: false, inverted: true });
    const node = findNode(toggled.root, layer.id)!;

    expect(node.mask).toMatchObject({ enabled: false, inverted: true });
    expect(node.mask?.source?.x).toBe(9);
  });

  it('removes cleanly', () => {
    const base = createDocument();
    const layer = createRasterLayer(channel(), 'Photo');
    const doc = setNodeProps(addNode(base, layer), layer.id, { mask: createMask('layer', channel()) });

    expect(findNode(setNodeMask(doc, layer.id, undefined).root, layer.id)!.mask).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('exporting a masked layer as SVG', () => {
  it('writes a luminance mask for a layer mask', () => {
    const base = createDocument();
    const layer = createVectorLayer('Ink', {
      objects: [createRect({ x: 0, y: 0, width: 50, height: 50 }, { fill: '#000000' })],
      mask: createMask('layer', channel()),
    });
    const svg = documentToSvg(addNode(base, layer));

    // SVG's `<mask>` is luminance-based by default, which is the same rule the
    // canvas compositor implements by hand — so no conversion, only wrapping.
    expect(svg).toContain('<mask id="mask-');
    expect(svg).toMatch(/mask="url\(#mask-\d+\)"/);
  });

  it('writes an alpha mask built from the layer below for a clipping mask', () => {
    const { doc } = clippedStack();
    const svg = documentToSvg(doc);

    // `mask-type:alpha` is what makes a `<mask>` use its content's transparency
    // rather than its luminance — precisely "the shape of the layer below".
    expect(svg).toContain('mask-type:alpha');
    expect(svg).toMatch(/<g mask="url\(#clip-\d+\)">/);
  });

  it('does not give the base two elements with the same id', () => {
    const { doc, baseId } = clippedStack();
    const svg = documentToSvg(doc);

    // The base is written twice — once as itself, once inside the `<mask>` —
    // and two elements answering to one id renders unpredictably and breaks
    // every `href="#…"` pointing at it. The copy inside the mask is the one
    // that loses its identity, since nothing references it.
    expect(svg.match(new RegExp(`id="${baseId}"`, 'g'))).toHaveLength(1);

    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops the clipped layer when its base is hidden', () => {
    const { doc, baseId } = clippedStack();
    const hidden: DrawingDocument = {
      ...doc,
      root: normalizeTree({
        ...doc.root,
        children: doc.root.children.map((c) => (c.id === baseId ? { ...c, visible: false } : c)),
      }),
    };

    const svg = documentToSvg(hidden);
    // A clipped layer is painted *into* the base's pixels; a base with none on
    // screen has none to paint into.
    expect(svg).not.toContain('mask-type:alpha');
    expect(svg).not.toContain('#ff0000');
  });

  it('leaves a clipped layer alone when there is nothing below it', () => {
    const document_ = createDocument({ canvas: { width: 100, height: 100 } });
    const orphan = createVectorLayer('Clipped', {
      objects: [createRect({ x: 0, y: 0, width: 50, height: 50 }, { fill: '#ff0000' })],
      mask: createMask('clipping'),
    });
    const svg = documentToSvg({ ...document_, root: normalizeTree({ ...document_.root, children: [orphan] }) });

    // Nothing to clip to. Drawing it unclipped shows the work; dropping it
    // would look like the layer had been deleted.
    expect(svg).not.toContain('mask-type:alpha');
  });

  it('clips a run of layers to one base, not each to the one beneath', () => {
    const document_ = createDocument({ canvas: { width: 200, height: 200 } });
    const base = createVectorLayer('Base', {
      objects: [createRect({ x: 0, y: 0, width: 100, height: 100 }, { fill: '#000000' })],
    });
    const first = createVectorLayer('First', {
      objects: [createRect({ x: 0, y: 0, width: 200, height: 200 }, { fill: '#ff0000' })],
      mask: createMask('clipping'),
    });
    const second = createVectorLayer('Second', {
      objects: [createRect({ x: 0, y: 0, width: 200, height: 200 }, { fill: '#00ff00' })],
      mask: createMask('clipping'),
    });

    const svg = documentToSvg({
      ...document_,
      root: normalizeTree({ ...document_.root, children: [second, first, base] }),
    });

    // Two clipping groups, both built from the same base — which is the rule
    // every other editor uses and the reason the base is tracked across the
    // whole run rather than being "the previous sibling".
    expect(svg.match(/mask-type:alpha/g)).toHaveLength(2);
    expect(svg.match(/data-name="Base"/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
