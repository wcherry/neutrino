/**
 * The OpenRaster reader — redesign phase 3.
 *
 * Two things are being pinned down, and they are different promises:
 *
 * - **A foreign package opens.** A `.ora` from Krita or GIMP has nothing but
 *   `stack.xml` and PNGs, so every layer must come back as a raster layer with
 *   the right size, offset, opacity, visibility and blend mode — and anything
 *   the reader does not recognise must be *ignored* rather than fatal.
 * - **A Neutrino package round-trips losslessly.** Write a document with vector
 *   shapes, text and a mask, read it back, and the vectors are still vectors.
 *   That is the whole point of the manifest, and the assertion that stops
 *   somebody "simplifying" the reader into the `stack.xml` path for everything.
 *
 * Packages are built here with JSZip rather than checked in as fixtures, so a
 * failure names the attribute that broke instead of a byte offset.
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';

import {
  createDocument,
  createMask,
  createRasterLayer,
  createRect,
  createStack,
  createTextLayer,
  createVectorLayer,
} from '../../app/(apps)/drawing/editor/document/factory';
import { addNode, addObjects, setNodeProps } from '../../app/(apps)/drawing/editor/document/edits';
import { findNode, flattenTree, normalizeTree } from '../../app/(apps)/drawing/editor/document/tree';
import {
  DEFAULT_ORA_DPI,
  OraReadError,
  parseStackXml,
  pngSize,
  readOra,
  writeOra,
  type OraRenderer,
} from '../../app/(apps)/drawing/editor/io/ora';
import type { DrawingDocument, DrawingNode } from '../../app/(apps)/drawing/editor/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A real 2×3 PNG, base64.
 *
 * Real bytes rather than a stub, because `pngSize` reads the IHDR out of them —
 * a placeholder string would make every layer in these tests unreadable for the
 * right reason and the wrong one.
 */
const PNG_2x3 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAACzTKB5AAAAEklEQVR42mP8z8Dwn4GBgYEBAA8AAv/JbdD5AAAAAElFTkSuQmCC';

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_2x3), (c) => c.charCodeAt(0));
}

/** A package with the given `stack.xml`, plus a PNG at each named path. */
async function foreignOra(stackXml: string, assets: string[] = ['data/layer0.png']): Promise<Blob> {
  const zip = new JSZip();
  zip.file('mimetype', 'image/openraster', { compression: 'STORE' });
  zip.file('stack.xml', stackXml);
  for (const path of assets) zip.file(path, pngBytes());
  zip.file('mergedimage.png', pngBytes());
  zip.file('Thumbnails/thumbnail.png', pngBytes());
  return zip.generateAsync({ type: 'blob' });
}

function stubRenderer(): OraRenderer {
  const png = () => new Blob([PNG_2x3], { type: 'image/png' });
  return {
    renderLayer: vi.fn(async () => ({ png: png(), x: 0, y: 0 })),
    renderMask: vi.fn(async () => ({ png: png(), x: 0, y: 0 })),
    renderMerged: vi.fn(async () => png()),
    renderThumbnail: vi.fn(async () => png()),
    renderSelection: vi.fn(async () => null),
  };
}

// ---------------------------------------------------------------------------
// stack.xml
// ---------------------------------------------------------------------------

describe('parsing stack.xml', () => {
  it('reads the canvas, and defaults the resolution the way OpenRaster does', () => {
    const parsed = parseStackXml(
      '<image version="0.0.3" w="640" h="480" name="Poster"><stack/></image>',
    )!;

    expect(parsed.width).toBe(640);
    expect(parsed.height).toBe(480);
    expect(parsed.name).toBe('Poster');
    // Absent `xres` is 72 per the specification, not the app's own 96.
    expect(parsed.dpi).toBe(DEFAULT_ORA_DPI);
  });

  it('keeps the document order — first child topmost', () => {
    const parsed = parseStackXml(
      `<image w="10" h="10"><stack>
         <layer name="Top" src="a.png"/>
         <layer name="Bottom" src="b.png"/>
       </stack></image>`,
    )!;

    expect(parsed.root.children.map((c) => c.name)).toEqual(['Top', 'Bottom']);
  });

  it('applies a default to every optional attribute', () => {
    const parsed = parseStackXml('<image w="10" h="10"><stack><layer src="a.png"/></stack></image>')!;
    const layer = parsed.root.children[0];

    expect(layer).toMatchObject({
      type: 'layer', name: '', opacity: 1, visible: true, blendMode: 'normal',
      locked: false, selected: false, x: 0, y: 0,
    });
  });

  it('treats anything but the literal "hidden" as visible', () => {
    // Files in the wild write "1", "0" and nothing at all; only "hidden" means
    // hidden, and reading the others as such loses layers silently.
    const xml = (value: string) => `<image w="10" h="10"><stack><layer src="a.png" visibility="${value}"/></stack></image>`;
    expect(parseStackXml(xml('visible'))!.root.children[0].visible).toBe(true);
    expect(parseStackXml(xml('1'))!.root.children[0].visible).toBe(true);
    expect(parseStackXml(xml('hidden'))!.root.children[0].visible).toBe(false);
  });

  it('reads the two extensions the writer emits', () => {
    const parsed = parseStackXml(
      '<image w="10" h="10"><stack><layer src="a.png" edit-locked="true" selected="true"/></stack></image>',
    )!;
    expect(parsed.root.children[0]).toMatchObject({ locked: true, selected: true });
  });

  it('ignores an element it does not recognise instead of failing', () => {
    const parsed = parseStackXml(
      `<image w="10" h="10"><stack>
         <filters><blur radius="4"/></filters>
         <layer name="Ink" src="a.png"/>
       </stack></image>`,
    )!;

    // The unknown wrapper is dropped whole — its children say nothing about
    // what they mean here — and the layer beside it still arrives.
    expect(parsed.root.children).toHaveLength(1);
    expect(parsed.root.children[0].name).toBe('Ink');
  });

  it('drops a layer with no src rather than pointing at nothing', () => {
    const parsed = parseStackXml('<image w="10" h="10"><stack><layer name="Ghost"/></stack></image>')!;
    expect(parsed.root.children).toHaveLength(0);
  });

  it('refuses markup that is not an OpenRaster stack', () => {
    expect(parseStackXml('<svg/>')).toBeNull();
    expect(parseStackXml('<image w="0" h="0"><stack/></image>')).toBeNull();
    expect(parseStackXml('not xml at <all')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Image dimensions
// ---------------------------------------------------------------------------

describe('reading a PNG’s size', () => {
  it('reads width and height out of the IHDR', () => {
    // Straight from the bytes, so a package of forty layers does not have to be
    // decoded before anything can be drawn.
    expect(pngSize(pngBytes())).toEqual({ width: 2, height: 3 });
  });

  it('returns null for bytes that are not a PNG', () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngSize(new Uint8Array(32))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Foreign packages
// ---------------------------------------------------------------------------

describe('opening a package from another application', () => {
  it('turns every layer into a raster layer, sized from its own PNG', async () => {
    const blob = await foreignOra(
      `<image version="0.0.3" w="200" h="100" xres="300" name="From Krita"><stack>
         <layer name="Ink" src="data/layer0.png" x="12" y="34" opacity="0.5"
                composite-op="svg:multiply" visibility="hidden" edit-locked="true"/>
       </stack></image>`,
    );

    const { document, fromManifest } = await readOra(blob);

    expect(fromManifest).toBe(false);
    expect(document.canvas).toMatchObject({ width: 200, height: 100, dpi: 300 });
    // OpenRaster composites onto nothing, so an imported document is
    // transparent — defaulting to white would flatten away what the file was
    // saved for.
    expect(document.canvas.background).toBeNull();
    expect(document.metadata.title).toBe('From Krita');

    const layer = document.root.children[0];
    expect(layer.type).toBe('raster');
    expect(layer).toMatchObject({ name: 'Ink', opacity: 0.5, visible: false, blendMode: 'multiply', locked: true });
    if (layer.type !== 'raster') throw new Error('expected a raster layer');
    expect(layer.source).toMatchObject({ width: 2, height: 3, x: 12, y: 34 });
    expect(layer.source.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('nests a stack as a group, keeping the order', async () => {
    const blob = await foreignOra(
      `<image w="50" h="50"><stack>
         <stack name="Group" isolation="isolate">
           <layer name="Inside" src="data/layer0.png"/>
         </stack>
         <layer name="Below" src="data/layer1.png"/>
       </stack></image>`,
      ['data/layer0.png', 'data/layer1.png'],
    );

    const { document } = await readOra(blob);
    const [group, below] = document.root.children;

    expect(group.type).toBe('stack');
    expect(group.name).toBe('Group');
    if (group.type !== 'stack') throw new Error('expected a group');
    expect(group.isolation).toBe('isolate');
    expect(group.children.map((c) => c.name)).toEqual(['Inside']);
    expect(below.name).toBe('Below');
  });

  it('drops a layer whose asset is missing from the archive', async () => {
    const blob = await foreignOra(
      `<image w="50" h="50"><stack>
         <layer name="Present" src="data/layer0.png"/>
         <layer name="Absent" src="data/nowhere.png"/>
       </stack></image>`,
    );

    const { document } = await readOra(blob);
    // Keeping it would put a row in the panel that draws nothing and can never
    // be repaired, and would make the next export reference a missing entry.
    expect(document.root.children.map((c) => c.name)).toEqual(['Present']);
  });

  it('opens a package with no layers as an empty drawing rather than failing', async () => {
    const { document } = await readOra(await foreignOra('<image w="80" h="60"><stack/></image>', []));

    expect(document.canvas.width).toBe(80);
    // The one empty vector layer a new document gets — the drawing tools need
    // somewhere to draw, and an empty canvas beats an error for an empty file.
    expect(document.root.children).toHaveLength(1);
    expect(document.root.children[0].type).toBe('vector');
  });

  it('reports the layer marked with the selection extension', async () => {
    const blob = await foreignOra(
      `<image w="50" h="50"><stack>
         <layer name="A" src="data/layer0.png"/>
         <layer name="B" src="data/layer1.png" selected="true"/>
       </stack></image>`,
      ['data/layer0.png', 'data/layer1.png'],
    );

    const { document, selectedNodeId } = await readOra(blob);
    const selected = document.root.children.find((c) => c.id === selectedNodeId);
    expect(selected?.name).toBe('B');
  });

  it('explains what is wrong instead of failing anonymously', async () => {
    const empty = new JSZip();
    empty.file('mimetype', 'image/openraster');
    await expect(readOra(await empty.generateAsync({ type: 'blob' })))
      .rejects.toThrow(OraReadError);

    const wrongType = new JSZip();
    wrongType.file('mimetype', 'application/zip');
    await expect(readOra(await wrongType.generateAsync({ type: 'blob' })))
      .rejects.toThrow(/other than OpenRaster/);

    await expect(readOra(new Blob(['not a zip at all'])))
      .rejects.toThrow(/not a readable OpenRaster package/);
  });

  it('accepts a package with no mimetype entry', async () => {
    // A stricter reader would be within its rights to refuse this, and would
    // also refuse several real writers. `stack.xml` parsing is the stronger
    // signal.
    const zip = new JSZip();
    zip.file('stack.xml', '<image w="10" h="10"><stack><layer src="data/layer0.png"/></stack></image>');
    zip.file('data/layer0.png', pngBytes());

    const { document } = await readOra(await zip.generateAsync({ type: 'blob' }));
    expect(document.root.children[0].type).toBe('raster');
  });
});

// ---------------------------------------------------------------------------
// The Neutrino round trip
// ---------------------------------------------------------------------------

/** A document with a vector shape, a text layer, a group and a masked raster layer. */
function richDocument(): DrawingDocument {
  const base = createDocument({ title: 'Everything', canvas: { width: 400, height: 300 } });
  const vector = flattenTree(base.root).find((f) => f.node.type === 'vector')!.node;
  let doc = addObjects(base, vector.id, [createRect({ x: 10, y: 10, width: 80, height: 40 })]);

  doc = addNode(doc, createTextLayer({ x: 0, y: 0, width: 200, height: 40 }, 'A caption'));

  const photo = createRasterLayer(
    { dataUrl: `data:image/png;base64,${PNG_2x3}`, width: 2, height: 3, x: 5, y: 6 },
    'Photo',
  );
  doc = addNode(doc, photo);
  doc = setNodeProps(doc, photo.id, {
    blendMode: 'screen',
    opacity: 0.4,
    mask: createMask('layer', { dataUrl: `data:image/png;base64,${PNG_2x3}`, width: 2, height: 3, x: 0, y: 0 }),
  });

  const inner = createVectorLayer('Inside');
  const group = createStack('Group');
  group.children = [inner];
  return { ...doc, root: normalizeTree({ ...doc.root, children: [group, ...doc.root.children] }) };
}

describe('re-opening a package this app wrote', () => {
  it('gets every layer back as the kind it was, not as flat pixels', async () => {
    const original = richDocument();
    const blob = await writeOra(original, stubRenderer());

    const { document, fromManifest } = await readOra(blob);

    expect(fromManifest).toBe(true);
    // The point of the manifest: a rasterised fallback exists for every reader
    // in the world, and this one uses the editable original instead.
    const types = new Map<string, DrawingNode['type']>();
    for (const { node } of flattenTree(document.root)) types.set(node.name, node.type);
    expect(types.get('Layer 1')).toBe('vector');
    expect(types.get('A caption')).toBe('text');
    expect(types.get('Photo')).toBe('raster');
    expect(types.get('Group')).toBe('stack');
  });

  it('keeps canvas, metadata, grid and guides', async () => {
    const original = richDocument();
    const { document } = await readOra(await writeOra(original, stubRenderer()));

    expect(document.canvas).toEqual(original.canvas);
    expect(document.grid).toEqual(original.grid);
    expect(document.metadata.title).toBe('Everything');
  });

  it('keeps a layer’s mask, blend mode and opacity', async () => {
    const original = richDocument();
    const photo = flattenTree(original.root).find((f) => f.node.name === 'Photo')!.node;

    const { document } = await readOra(await writeOra(original, stubRenderer()));
    const restored = findNode(document.root, photo.id)!;

    expect(restored.blendMode).toBe('screen');
    expect(restored.opacity).toBeCloseTo(0.4);
    expect(restored.mask?.kind).toBe('layer');
    expect(restored.mask?.source).not.toBeNull();
  });

  it('keeps object and layer ids, so a reference survives the trip', async () => {
    const original = richDocument();
    const { document } = await readOra(await writeOra(original, stubRenderer()));

    const originalIds = flattenTree(original.root).map((f) => f.node.id).sort();
    const restoredIds = flattenTree(document.root).map((f) => f.node.id).sort();
    // Ids are what a mask relationship, a symbol instance and a `<textPath>`
    // binding all point at; regenerating them on read would break all three.
    expect(restoredIds).toEqual(originalIds);
  });

  it('falls back to stack.xml when the manifest is damaged', async () => {
    const blob = await writeOra(richDocument(), stubRenderer());
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    zip.file('META-INF/neutrino/document.json', '{ this is not json');

    const { document, fromManifest } = await readOra(await zip.generateAsync({ type: 'blob' }));

    // A Neutrino file with a broken manifest still opens — as flat layers,
    // which is what every other reader would have seen anyway.
    expect(fromManifest).toBe(false);
    expect(flattenTree(document.root).every((f) => f.node.type !== 'text')).toBe(true);
  });
});
