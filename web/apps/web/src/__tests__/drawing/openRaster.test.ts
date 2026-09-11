/**
 * The OpenRaster writer.
 *
 * What is checked here is the *package* — the thing another application opens —
 * rather than the pixels, which is why the renderer is injected as a stub. That
 * is not a workaround for jsdom having no canvas (though it is also that): the
 * branching lives in which layers exist, what `stack.xml` says about them and
 * what the Neutrino manifest carries, and none of that is about colour.
 *
 * The archive rules being pinned down come from the OpenRaster file-layout
 * spec, and both have the same failure mode — the file still unzips, and strict
 * readers reject it:
 *
 * - `mimetype` is the **first** entry, and it is **stored uncompressed**.
 * - Every `<layer src="…">` names an entry that is actually in the archive.
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';

import {
  createAdjustmentLayer,
  createDocument,
  createMask,
  createRasterLayer,
  createRect,
  createStack,
  createTextLayer,
  createVectorLayer,
} from '../../app/(apps)/drawing/editor/document/factory';
import { createFilter } from '../../app/(apps)/drawing/editor/document/filters';
import {
  addFilter,
  addNode,
  addObjects,
  setColorProfile,
  setNodeProps,
} from '../../app/(apps)/drawing/editor/document/edits';
import { iccDataUrl } from '../../app/(apps)/drawing/editor/io/icc';
import { findNode, flattenTree, insertNode, normalizeTree } from '../../app/(apps)/drawing/editor/document/tree';
import {
  buildStackXml,
  createCanvasRenderer,
  fromCompositeOp,
  toCompositeOp,
  writeOra,
  type OraRenderer,
} from '../../app/(apps)/drawing/editor/io/ora';
import { BLEND_MODES, type DrawingDocument, type DrawingNode } from '../../app/(apps)/drawing/editor/types';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function png(label: string): Blob {
  return new Blob([label], { type: 'image/png' });
}

/**
 * A renderer that produces a labelled stand-in per node, so a test can tell
 * which entry came from which layer without decoding an image.
 *
 * `empty` names the nodes that render to nothing — the case `stack.xml` has to
 * omit rather than point at a missing entry.
 */
function stubRenderer(empty: Set<string> = new Set()): OraRenderer {
  return {
    renderLayer: vi.fn(async (node: DrawingNode) =>
      empty.has(node.id) ? null : { png: png(`layer:${node.id}`), x: 12, y: 34 }),
    renderMask: vi.fn(async (node: DrawingNode) =>
      node.mask?.source ? { png: png(`mask:${node.mask.id}`), x: 1, y: 2 } : null),
    renderMerged: vi.fn(async () => png('merged')),
    renderThumbnail: vi.fn(async () => png('thumb')),
  };
}

function rasterSource(overrides: Record<string, number> = {}) {
  return { dataUrl: PIXEL, width: 10, height: 10, x: 0, y: 0, ...overrides };
}

async function open(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

/** A document with a vector layer holding one rectangle, plus a raster layer. */
function sampleDocument(): DrawingDocument {
  const base = createDocument({ title: 'Sample', canvas: { width: 400, height: 300 } });
  const vector = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;
  const withRect = addObjects(base, vector.id, [createRect({ x: 10, y: 10, width: 80, height: 40 })]);
  return addNode(withRect, createRasterLayer(rasterSource(), 'Photo'));
}

// ---------------------------------------------------------------------------
// Archive layout
// ---------------------------------------------------------------------------

describe('the archive', () => {
  it('puts mimetype first and stores it uncompressed', async () => {
    const blob = await writeOra(sampleDocument(), stubRenderer());
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Read the raw local file header rather than asking JSZip, which does not
    // report the stored compression method back after a load. A reader
    // identifies an OpenRaster file from exactly these bytes, so this is the
    // form the assertion should take.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

    const compressionMethod = bytes[8] | (bytes[9] << 8);
    expect(compressionMethod).toBe(0); // 0 = stored, 8 = deflated

    const nameLength = bytes[26] | (bytes[27] << 8);
    const extraLength = bytes[28] | (bytes[29] << 8);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
    expect(name).toBe('mimetype');

    const contentAt = 30 + nameLength + extraLength;
    const content = new TextDecoder().decode(bytes.slice(contentAt, contentAt + 16));
    expect(content).toBe('image/openraster');

    const zip = await open(blob);
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
  });

  it('contains every file OpenRaster requires', async () => {
    const zip = await open(await writeOra(sampleDocument(), stubRenderer()));

    for (const required of ['mimetype', 'stack.xml', 'mergedimage.png', 'Thumbnails/thumbnail.png']) {
      expect(zip.file(required), `${required} is missing`).not.toBeNull();
    }
  });

  it('writes one data/ entry per leaf layer and none for groups', async () => {
    const base = sampleDocument();
    const group = createStack('Group');
    const inside = createVectorLayer('Inside');
    group.children = [inside];
    const doc = { ...base, root: normalizeTree(insertNode(base.root, group)) };

    const zip = await open(await writeOra(doc, stubRenderer()));
    const layerEntries = Object.keys(zip.files).filter((n) => n.startsWith('data/layer-'));

    const leaves = flattenTree(doc.root).filter((f) => f.node.type !== 'stack');
    expect(layerEntries).toHaveLength(leaves.length);
    // A group carries no pixels of its own; its children carry them.
    expect(layerEntries.some((n) => n.includes(group.id))).toBe(false);
  });

  it('never points stack.xml at an entry it did not write', async () => {
    const doc = sampleDocument();
    const emptyLayer = flattenTree(doc.root).find((f) => f.node.type === 'vector')!.node;

    const zip = await open(await writeOra(doc, stubRenderer(new Set([emptyLayer.id]))));
    const xml = await zip.file('stack.xml')!.async('string');

    const sources = [...xml.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(zip.file(src), `${src} is referenced but absent`).not.toBeNull();
    }
    // The layer that rendered to nothing is left out entirely.
    expect(xml).not.toContain(emptyLayer.id);
  });
});

// ---------------------------------------------------------------------------
// stack.xml
// ---------------------------------------------------------------------------

describe('stack.xml', () => {
  it('declares the canvas size and resolution', () => {
    const doc = createDocument({ title: 'Poster', canvas: { width: 800, height: 600, dpi: 300 } });
    const xml = buildStackXml(doc, { assets: new Map() });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('w="800"');
    expect(xml).toContain('h="600"');
    expect(xml).toContain('xres="300"');
    expect(xml).toContain('yres="300"');
    expect(xml).toContain('name="Poster"');
  });

  it('keeps the children order, first child topmost', async () => {
    const base = createDocument();
    const top = createVectorLayer('Top');
    const bottom = createVectorLayer('Bottom');
    const doc = { ...base, root: normalizeTree({ ...base.root, children: [top, bottom] }) };

    const zip = await open(await writeOra(doc, stubRenderer()));
    const xml = await zip.file('stack.xml')!.async('string');

    // No reversal anywhere: the model and the format agree on order.
    expect(xml.indexOf('name="Top"')).toBeLessThan(xml.indexOf('name="Bottom"'));
  });

  it('nests a group as a stack element', async () => {
    const base = createDocument();
    const inside = createVectorLayer('Inside');
    const group = createStack('Group');
    group.children = [inside];
    const doc = { ...base, root: normalizeTree({ ...base.root, children: [group] }) };

    const zip = await open(await writeOra(doc, stubRenderer()));
    const xml = await zip.file('stack.xml')!.async('string');

    expect(xml).toContain('<stack name="Group"');
    expect(xml).toContain('isolation="auto"');
    // The child sits inside the group's element, not beside it.
    const groupStart = xml.indexOf('<stack name="Group"');
    const groupEnd = xml.indexOf('</stack>', groupStart);
    expect(xml.slice(groupStart, groupEnd)).toContain('name="Inside"');
  });

  it('writes visibility, opacity and the layer offsets', async () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const withLayer = addNode(base, layer);
    const doc = setNodeProps(withLayer, layer.id, { opacity: 0.25, visible: false });

    const zip = await open(await writeOra(doc, stubRenderer()));
    const xml = await zip.file('stack.xml')!.async('string');

    expect(xml).toContain('opacity="0.25"');
    expect(xml).toContain('visibility="hidden"');
    // The stub reports its offset; the writer must carry it, since a layer PNG
    // is the size of its own content rather than of the canvas.
    expect(xml).toContain('x="12"');
    expect(xml).toContain('y="34"');
  });

  it('marks a locked layer with the OpenRaster edit-locking attribute', async () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const doc = setNodeProps(addNode(base, layer), layer.id, { locked: true });

    const zip = await open(await writeOra(doc, stubRenderer()));
    const xml = await zip.file('stack.xml')!.async('string');
    expect(xml).toContain('edit-locked="true"');
  });

  it('marks the active layer with the selection attribute', () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const doc = addNode(base, layer);
    const assets = new Map([[layer.id, { nodeId: layer.id, src: 'data/layer-1.png', x: 0, y: 0 }]]);

    expect(buildStackXml(doc, { assets, selectedNodeId: layer.id })).toContain('selected="true"');
    expect(buildStackXml(doc, { assets })).not.toContain('selected="true"');
  });

  it('escapes a layer name that would otherwise break the XML', () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Rick & Morty "<script>"');
    const doc = addNode(base, layer);
    const assets = new Map([[layer.id, { nodeId: layer.id, src: 'data/layer-1.png', x: 0, y: 0 }]]);

    const xml = buildStackXml(doc, { assets });
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<script>');
  });
});

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

describe('composite-op', () => {
  it('maps normal to svg:src-over rather than svg:normal', () => {
    // The one irregular entry, and the reason this is a table and not a
    // find-and-replace: `svg:normal` looks right and composites wrong.
    expect(toCompositeOp('normal')).toBe('svg:src-over');
    expect(fromCompositeOp('svg:src-over')).toBe('normal');
  });

  it('round-trips every mode the model has', () => {
    for (const mode of BLEND_MODES) {
      expect(fromCompositeOp(toCompositeOp(mode))).toBe(mode);
    }
  });

  it('reads an operator it does not implement as normal', () => {
    // OpenRaster allows the whole Porter-Duff set; showing the layer with the
    // wrong compositing beats dropping it.
    expect(fromCompositeOp('svg:dst-atop')).toBe('normal');
    expect(fromCompositeOp('')).toBe('normal');
  });

  it('writes the layer’s mode into stack.xml', async () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const doc = setNodeProps(addNode(base, layer), layer.id, { blendMode: 'multiply' });

    const zip = await open(await writeOra(doc, stubRenderer()));
    expect(await zip.file('stack.xml')!.async('string')).toContain('composite-op="svg:multiply"');
  });
});

// ---------------------------------------------------------------------------
// The Neutrino manifest
// ---------------------------------------------------------------------------

describe('META-INF/neutrino/document.json', () => {
  it('carries the whole document, so the round trip is lossless', async () => {
    const doc = sampleDocument();
    const zip = await open(await writeOra(doc, stubRenderer()));

    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.document.canvas).toEqual(doc.canvas);
    expect(manifest.document.root.children).toHaveLength(doc.root.children.length);
    // Guides and grid live in the document, not in a second copy beside it.
    expect(manifest.document.grid).toEqual(doc.grid);
  });

  it('records what each rasterised PNG was rendered from', async () => {
    const base = createDocument();
    const text = createTextLayer({ x: 0, y: 0, width: 100, height: 40 }, 'Hello');
    const doc = addNode(base, text);

    const zip = await open(await writeOra(doc, stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));

    const entry = manifest.assets.find((a: { nodeId: string }) => a.nodeId === text.id);
    // Without this a reader would take the rendered pixels for a raster layer
    // and discard the text on the next save.
    expect(entry.renderedFrom).toBe('text');
    expect(entry.src).toContain('data/layer-');
  });

  it('writes a mask as its own asset plus a maskFor entry', async () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const withLayer = addNode(base, layer);
    const mask = createMask('transparency', rasterSource({ x: 3, y: 4 }));
    const doc = setNodeProps(withLayer, layer.id, { mask });

    const zip = await open(await writeOra(doc, stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));

    expect(manifest.masks).toHaveLength(1);
    expect(manifest.masks[0].maskFor).toBe(layer.id);
    expect(manifest.masks[0].mode).toBe('transparency');
    // The separate channel is what makes the mask editable again; the layer
    // PNG beside it already has the mask baked into its alpha.
    expect(zip.file(manifest.masks[0].maskSource)).not.toBeNull();
  });

  it('has no mask entry for a layer without one', async () => {
    const zip = await open(await writeOra(sampleDocument(), stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));
    expect(manifest.masks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adjustments, filters and colour — redesign phases 6 and 7
// ---------------------------------------------------------------------------

/** A minimal but structurally valid ICC profile, enough to be accepted. */
function iccBytes(): Uint8Array {
  const bytes = new Uint8Array(160);
  new DataView(bytes.buffer).setUint32(0, 160, false);
  bytes[8] = 2;
  bytes.set([...'RGB '].map((c) => c.charCodeAt(0)), 16);
  bytes.set([...'acsp'].map((c) => c.charCodeAt(0)), 36);
  return bytes;
}

describe('an adjustment layer in a package', () => {
  it('writes no layer element and no PNG for it', async () => {
    // §4's rule: the parameters are the Neutrino description, the merged image
    // is the rendered fallback, and **the source layers stay unchanged**. A
    // `<layer>` here would either point at an empty PNG or mean the correction
    // had been baked into the layers below.
    const base = sampleDocument();
    const adjustment = createAdjustmentLayer('levels');
    const doc = addNode(base, adjustment);

    const zip = await open(await writeOra(doc, stubRenderer()));
    const xml = await zip.file('stack.xml')!.async('string');
    expect(xml).not.toContain(adjustment.id);
    expect(Object.keys(zip.files).some((n) => n.includes(adjustment.id))).toBe(false);
  });

  it('lists it in the manifest, pointing at the merged image', async () => {
    const adjustment = createAdjustmentLayer('curves');
    const zip = await open(await writeOra(addNode(sampleDocument(), adjustment), stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));

    expect(manifest.adjustments).toEqual([
      { nodeId: adjustment.id, kind: 'curves', renderedFallback: 'mergedimage.png' },
    ]);
    // And the parameters themselves ride along in the document copy.
    expect(manifest.document.root.children.some((c: { id: string }) => c.id === adjustment.id)).toBe(true);
  });
});

describe('filters in a package', () => {
  it('records which PNG the result was baked into', async () => {
    // A filter's fallback is per-layer rather than the merged image, because
    // the layer PNG is rendered *through* the chain — so a reader that knows
    // nothing about filters opens a blurred layer already blurred.
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const doc = addFilter(addNode(base, layer), layer.id, createFilter('blur'));

    const zip = await open(await writeOra(doc, stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));

    expect(manifest.filters).toHaveLength(1);
    expect(manifest.filters[0]).toMatchObject({ nodeId: layer.id, kinds: ['blur'] });
    expect(zip.file(manifest.filters[0].renderedInto)).not.toBeNull();
  });

  it('leaves a disabled filter out of the list', async () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const doc = addFilter(addNode(base, layer), layer.id, { ...createFilter('blur'), enabled: false });

    const zip = await open(await writeOra(doc, stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));
    expect(manifest.filters).toEqual([]);
  });
});

describe('the colour profile in a package', () => {
  it('writes an embedded profile as its own archive entry', async () => {
    const doc = setColorProfile(sampleDocument(), { name: 'Test RGB', iccUri: iccDataUrl(iccBytes()) });
    const zip = await open(await writeOra(doc, stubRenderer()));

    expect(zip.file('META-INF/neutrino/color.icc')).not.toBeNull();
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));
    expect(manifest.color.icc).toBe('META-INF/neutrino/color.icc');
  });

  it('writes no profile entry when the bytes are not a profile', async () => {
    // Bytes that are not a profile would produce an `iCCP` chunk strict
    // decoders refuse — the picture lost to a metadata error.
    const doc = setColorProfile(sampleDocument(), {
      name: 'Bogus',
      iccUri: 'data:application/vnd.iccprofile;base64,AAAA',
    });
    const zip = await open(await writeOra(doc, stubRenderer()));

    expect(zip.file('META-INF/neutrino/color.icc')).toBeNull();
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));
    expect(manifest.color.icc).toBeNull();
  });

  it('always records the space and depth, profile or not', async () => {
    const zip = await open(await writeOra(sampleDocument(), stubRenderer()));
    const manifest = JSON.parse(await zip.file('META-INF/neutrino/document.json')!.async('string'));
    expect(manifest.color).toMatchObject({ space: 'srgb', bitDepth: 8, icc: null, hdr: null });
  });
});

// ---------------------------------------------------------------------------
// The canvas renderer's geometry
// ---------------------------------------------------------------------------

/**
 * A surface that records its size and the draws made on it, so the renderer's
 * *arithmetic* can be checked without real pixels — which layer rectangle it
 * chose, where it placed the origin, how it scaled the thumbnail.
 *
 * This is the half the stub renderer above deliberately does not exercise, and
 * it is where the interesting mistakes live: a layer PNG is the size of its own
 * content rather than of the canvas, so an off-by-one here is a clipped layer
 * in every application that opens the file.
 */
interface FakeSurface {
  width: number;
  height: number;
  translated: { x: number; y: number }[];
  drawn: { width: number; height: number }[];
  getContext(id: '2d'): CanvasRenderingContext2D | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
}

function fakeSurfaces() {
  const made: FakeSurface[] = [];

  const factory = (width: number, height: number): FakeSurface => {
    const surface: FakeSurface = {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      translated: [],
      drawn: [],
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
      toBlob: (callback) => callback(png('rendered')),
    };
    // Only the operations the renderer actually depends on; everything else is
    // a no-op, since nothing here inspects colour.
    const ctx = {
      canvas: surface,
      save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
      moveTo: () => {}, lineTo: () => {}, rect: () => {}, ellipse: () => {},
      roundRect: () => {}, fill: () => {}, stroke: () => {}, fillRect: () => {},
      clearRect: () => {}, clip: () => {}, rotate: () => {}, scale: () => {},
      transform: () => {}, setTransform: () => {}, setLineDash: () => {},
      fillText: () => {}, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => null,
      getImageData: (_x: number, _y: number, w: number, h: number) =>
        ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
      translate: (x: number, y: number) => { surface.translated.push({ x, y }); },
      drawImage: (_image: unknown, ...args: number[]) => {
        surface.drawn.push({ width: args[2] ?? 0, height: args[3] ?? 0 });
      },
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '',
      lineCap: '', lineJoin: '', shadowColor: '', shadowBlur: 0,
      shadowOffsetX: 0, shadowOffsetY: 0,
    };
    made.push(surface);
    return surface;
  };

  return { made, factory: factory as unknown as NonNullable<Parameters<typeof createCanvasRenderer>[1]>['createSurface'] };
}

describe('the canvas renderer', () => {
  it('sizes a layer PNG to its own content, not to the canvas', async () => {
    const base = createDocument({ canvas: { width: 1000, height: 800 } });
    const vector = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;
    // Stroke width 0 keeps the arithmetic exactly the rectangle's own size.
    const doc = addObjects(base, vector.id, [
      createRect({ x: 100, y: 50, width: 60, height: 40 }, { strokeWidth: 0, fill: '#000' }),
    ]);

    const { made, factory } = fakeSurfaces();
    const renderer = createCanvasRenderer(doc, { createSurface: factory });
    const layer = await renderer.renderLayer(findNode(doc.root, vector.id)!);

    expect(layer).not.toBeNull();
    expect(layer!.x).toBe(100);
    expect(layer!.y).toBe(50);
    // A canvas-sized PNG per layer is what OpenRaster's x/y offsets exist to
    // avoid; twelve small layers on a large canvas is the case that matters.
    expect(made[0].width).toBe(60);
    expect(made[0].height).toBe(40);
    // The origin is shifted so the content lands at the surface's top-left.
    expect(made[0].translated).toContainEqual({ x: -100, y: -50 });
  });

  it('clips a layer that hangs off the canvas', async () => {
    const base = createDocument({ canvas: { width: 200, height: 200 } });
    // Half off the left edge and half off the top.
    const layer = createRasterLayer(rasterSource({ x: -40, y: -40, width: 100, height: 100 }), 'Photo');
    const doc = addNode(base, layer);

    const { made, factory } = fakeSurfaces();
    const rendered = await createCanvasRenderer(doc, { createSurface: factory })
      .renderLayer(findNode(doc.root, layer.id)!);

    expect(rendered!.x).toBe(0);
    expect(rendered!.y).toBe(0);
    expect(made[0].width).toBe(60);
    expect(made[0].height).toBe(60);
  });

  it('returns nothing for a layer entirely outside the canvas', async () => {
    const base = createDocument({ canvas: { width: 200, height: 200 } });
    const layer = createRasterLayer(rasterSource({ x: 900, y: 900, width: 50, height: 50 }), 'Photo');
    const doc = addNode(base, layer);

    const { factory } = fakeSurfaces();
    const rendered = await createCanvasRenderer(doc, { createSurface: factory })
      .renderLayer(findNode(doc.root, layer.id)!);

    // Nothing to write, so `stack.xml` omits the layer rather than pointing at
    // a zero-pixel entry.
    expect(rendered).toBeNull();
  });

  it('returns nothing for an empty layer', async () => {
    const doc = createDocument();
    const vector = flattenTree(doc.root).find((f) => f.node.type === 'vector')!.node;

    const { factory } = fakeSurfaces();
    expect(await createCanvasRenderer(doc, { createSurface: factory }).renderLayer(vector)).toBeNull();
  });

  it('renders the merged image at full canvas size', async () => {
    const doc = createDocument({ canvas: { width: 640, height: 480 } });

    const { made, factory } = fakeSurfaces();
    await createCanvasRenderer(doc, { createSurface: factory }).renderMerged();

    expect(made[0].width).toBe(640);
    expect(made[0].height).toBe(480);
  });

  it('fits the thumbnail inside 256px on its longest side, keeping the aspect ratio', async () => {
    const doc = createDocument({ canvas: { width: 1000, height: 500 } });

    const { made, factory } = fakeSurfaces();
    await createCanvasRenderer(doc, { createSurface: factory }).renderThumbnail();

    // The full-size surface first, then the thumbnail it is scaled into.
    const thumb = made[made.length - 1];
    expect(thumb.width).toBe(256);
    expect(thumb.height).toBe(128);
  });

  it('does not enlarge a thumbnail for a canvas smaller than the limit', async () => {
    const doc = createDocument({ canvas: { width: 80, height: 40 } });

    const { made, factory } = fakeSurfaces();
    await createCanvasRenderer(doc, { createSurface: factory }).renderThumbnail();

    const thumb = made[made.length - 1];
    expect(thumb.width).toBe(80);
    expect(thumb.height).toBe(40);
  });

  it('writes a mask channel at its own size, untouched', async () => {
    const base = createDocument();
    const layer = createRasterLayer(rasterSource(), 'Photo');
    const withLayer = addNode(base, layer);
    const mask = createMask('layer', rasterSource({ x: 11, y: 22, width: 30, height: 40 }));
    const doc = setNodeProps(withLayer, layer.id, { mask });

    const { made, factory } = fakeSurfaces();
    const bitmaps = new Map<string, CanvasImageSource>([[PIXEL, {} as CanvasImageSource]]);
    const rendered = await createCanvasRenderer(doc, { createSurface: factory, bitmaps })
      .renderMask(findNode(doc.root, layer.id)!);

    expect(rendered!.x).toBe(11);
    expect(rendered!.y).toBe(22);
    // Re-encoding through a canvas-sized surface would surround the channel
    // with transparent pixels, which read as "hide everything here".
    expect(made[0].width).toBe(30);
    expect(made[0].height).toBe(40);
  });
});
