/**
 * Adjustment layers — redesign phase 6.
 *
 * Three things are pinned down here and they are the three that can go wrong
 * quietly:
 *
 * - **the arithmetic**, which is the whole of an adjustment and is pure, so it
 *   is checked directly rather than by looking at a rendered picture;
 * - **where the correction lands** — everything below the layer in its own
 *   stack, and nothing above it — which is the one property that makes an
 *   adjustment layer an adjustment *layer* rather than a filter;
 * - **the two emitters agreeing**, since the canvas applies a LUT or a matrix
 *   and the SVG exporter writes the same operation as `feComponentTransfer` or
 *   `feColorMatrix`, and a drift between them is an export that looks right on
 *   screen and wrong in the file.
 *
 * The compositor is exercised through a fake canvas that holds real pixels.
 * jsdom has no 2D context, and the alternative — asserting only that some
 * function was called — cannot tell "the adjustment was applied" from "the
 * adjustment was applied to the wrong layer".
 */

import { describe, it, expect } from 'vitest';

import {
  ADJUSTMENT_KINDS,
  adjustmentOps,
  createAdjustment,
  curveLut,
  identityLut,
  isIdentityLut,
  isNeutralAdjustment,
  multiplyColorMatrix,
  saturateMatrix,
  type AdjustmentSpec,
} from '../../app/(apps)/drawing/editor/document/adjustments';
import { applyColorOps, blendAdjusted, colorOpToSvg } from '../../app/(apps)/drawing/editor/render/colorOps';
import { createAdjustmentLayer, createDocument, createMask, createRasterLayer } from '../../app/(apps)/drawing/editor/document/factory';
import { addNode, patchAdjustment, setNodeProps } from '../../app/(apps)/drawing/editor/document/edits';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { documentToSvg } from '../../app/(apps)/drawing/editor/render/documentSvg';
import { renderDocument } from '../../app/(apps)/drawing/editor/render/renderDocument';
import { findNode } from '../../app/(apps)/drawing/editor/document/tree';
import { fakeBitmap, fakeSurfaceFactory, pixelAt } from './fakeCanvas';
import type { DrawingDocument } from '../../app/(apps)/drawing/editor/types';

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

/** One pixel through an adjustment, as the compositor would run it. */
function through(spec: AdjustmentSpec, rgb: [number, number, number]): [number, number, number] {
  const image = { data: new Uint8ClampedArray([...rgb, 255]), width: 1, height: 1 };
  applyColorOps(image, adjustmentOps(spec));
  return [image.data[0], image.data[1], image.data[2]];
}

describe('adjustment arithmetic', () => {
  it('starts at the identity wherever the identity is on the slider', () => {
    // Adding an adjustment layer must change nothing until a slider moves.
    // Anything else reads as having damaged the drawing.
    //
    // Black & White and Posterize are the two that cannot honour that, and
    // deliberately: their neutral settings are "don't" and "256 levels", which
    // are not points anyone would drag to. Listing them here rather than
    // skipping the rule means adding a third exception has to be argued for.
    const effects = new Set(['grayscale', 'posterize']);
    for (const kind of ADJUSTMENT_KINDS) {
      const spec = createAdjustment(kind);
      if (effects.has(kind)) {
        expect(isNeutralAdjustment(spec), `${kind} is unexpectedly neutral`).toBe(false);
        continue;
      }
      expect(isNeutralAdjustment(spec), `${kind} is not neutral by default`).toBe(true);
      expect(through(spec, [17, 128, 240])).toEqual([17, 128, 240]);
    }
  });

  it('brightens and darkens without moving the ends past the ends', () => {
    expect(through({ kind: 'brightness-contrast', brightness: 50, contrast: 0 }, [200, 200, 200]))
      .toEqual([255, 255, 255]);
    expect(through({ kind: 'brightness-contrast', brightness: -50, contrast: 0 }, [50, 50, 50]))
      .toEqual([0, 0, 0]);
  });

  it('pivots contrast about mid-grey', () => {
    // The definition of contrast: 128 is the fulcrum and does not move, while
    // everything either side of it spreads out.
    const spec: AdjustmentSpec = { kind: 'brightness-contrast', brightness: 0, contrast: 60 };
    expect(through(spec, [128, 128, 128])).toEqual([128, 128, 128]);
    expect(through(spec, [180, 180, 180])[0]).toBeGreaterThan(180);
    expect(through(spec, [80, 80, 80])[0]).toBeLessThan(80);
  });

  it('maps the levels input range onto the output range', () => {
    const spec: AdjustmentSpec = {
      kind: 'levels', inputBlack: 50, inputWhite: 200, gamma: 1, outputBlack: 0, outputWhite: 255,
    };
    expect(through(spec, [50, 50, 50])).toEqual([0, 0, 0]);
    expect(through(spec, [200, 200, 200])).toEqual([255, 255, 255]);
    // Anything below the black point clamps rather than going negative.
    expect(through(spec, [10, 10, 10])).toEqual([0, 0, 0]);
  });

  it('survives a collapsed levels range as a threshold rather than as NaN', () => {
    // A division by zero here would put NaN in the table and turn every pixel
    // black — the failure mode a clamp alone would not catch.
    const spec: AdjustmentSpec = {
      kind: 'levels', inputBlack: 128, inputWhite: 128, gamma: 1, outputBlack: 0, outputWhite: 255,
    };
    expect(through(spec, [127, 127, 127])).toEqual([0, 0, 0]);
    expect(through(spec, [129, 129, 129])).toEqual([255, 255, 255]);
  });

  it('interpolates a curve linearly between its handles', () => {
    const lut = curveLut([{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }]);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(200);
    expect(lut[255]).toBe(255);
    // Halfway between the first two handles, halfway between their outputs.
    expect(lut[64]).toBe(100);
  });

  it('reads a curve with fewer than two handles as the identity', () => {
    expect(isIdentityLut(curveLut([{ x: 100, y: 200 }]))).toBe(true);
    expect(isIdentityLut(curveLut([]))).toBe(true);
  });

  it('keeps a curve monotonic when two handles share an input', () => {
    // A vertical step is a legal thing to drag; dividing by the zero-width span
    // would produce Infinity and a table of 255s from that point on.
    const lut = curveLut([{ x: 0, y: 0 }, { x: 128, y: 10 }, { x: 128, y: 240 }, { x: 255, y: 255 }]);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it('posterizes to exactly the number of levels asked for', () => {
    const spec: AdjustmentSpec = { kind: 'posterize', levels: 4 };
    const seen = new Set<number>();
    for (let v = 0; v < 256; v++) seen.add(through(spec, [v, v, v])[0]);
    expect(seen.size).toBe(4);
    // The ends stay the ends, which is what stops a posterize also being a
    // brightness change.
    expect(through(spec, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(through(spec, [255, 255, 255])).toEqual([255, 255, 255]);
  });

  it('desaturates to the luma weighting every editor uses', () => {
    const [r, g, b] = through({ kind: 'grayscale', amount: 100 }, [255, 0, 0]);
    expect(r).toBe(g);
    expect(g).toBe(b);
    // 0.213 of full red, the sRGB luma coefficient in the SVG filter spec.
    expect(r).toBeCloseTo(Math.round(0.213 * 255), -1);
  });

  it('moves the midtones and leaves the ends alone in colour balance', () => {
    const spec: AdjustmentSpec = { kind: 'color-balance', red: 100, green: 0, blue: 0 };
    expect(through(spec, [128, 128, 128])[0]).toBeGreaterThan(128);
    // A flat shift would lift black off zero and clip white; the midtone
    // weighting is exactly what stops both.
    expect(through(spec, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(through(spec, [255, 255, 255])).toEqual([255, 255, 255]);
  });

  it('doubles the light for each stop of exposure', () => {
    const spec: AdjustmentSpec = { kind: 'exposure', exposure: 1, offset: 0, gamma: 1 };
    expect(through(spec, [60, 60, 60])).toEqual([120, 120, 120]);
  });

  it('composes colour matrices in the order they are applied', () => {
    // One composed matrix and the two applied in sequence have to agree, which
    // is the property a wrong multiplication order would break silently — a
    // hue rotation composed with a saturation is not the same as the two
    // multiplied the other way round.
    //
    // Within a unit, not exactly: applying in sequence quantises to eight bits
    // in between and composing does not, so the composed form is the *more*
    // accurate of the two. That is also why the renderer composes.
    const twice = multiplyColorMatrix(saturateMatrix(0.5), saturateMatrix(0.5));
    const image = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    applyColorOps(image, [{ kind: 'matrix', values: twice }]);

    const stepwise = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    applyColorOps(stepwise, [
      { kind: 'matrix', values: saturateMatrix(0.5) },
      { kind: 'matrix', values: saturateMatrix(0.5) },
    ]);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(image.data[i] - stepwise.data[i])).toBeLessThanOrEqual(1);
    }
  });

  it('leaves fully transparent pixels alone', () => {
    // A canvas-sized buffer is mostly transparent; adjusting those pixels costs
    // time and changes nothing visible, and skipping them is most of the speed.
    const image = { data: new Uint8ClampedArray([9, 9, 9, 0]), width: 1, height: 1 };
    applyColorOps(image, adjustmentOps({ kind: 'brightness-contrast', brightness: 100, contrast: 0 }));
    expect([...image.data]).toEqual([9, 9, 9, 0]);
  });
});

describe('mixing a partial adjustment', () => {
  it('blends towards the corrected pixels rather than fading them out', () => {
    const source = { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 };
    const adjusted = { data: new Uint8ClampedArray([100, 100, 100, 255]), width: 1, height: 1 };
    blendAdjusted(source, adjusted, 0.5, null);
    expect([...source.data]).toEqual([50, 50, 50, 255]);
  });

  it('uses the mask alpha as the per-pixel strength', () => {
    const source = { data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]), width: 2, height: 1 };
    const adjusted = { data: new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255]), width: 2, height: 1 };
    // First pixel fully masked in, second fully out.
    blendAdjusted(source, adjusted, 1, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]));
    expect(source.data[0]).toBe(200);
    expect(source.data[4]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Where the correction lands
// ---------------------------------------------------------------------------

const RED = 'data:image/png;base64,red';
const BLUE = 'data:image/png;base64,blue';

function layered(): { doc: DrawingDocument; bottomId: string; topId: string } {
  const base = createDocument({ canvas: { width: 4, height: 4, background: null } });
  // `children[0]` is topmost, so the blue layer added second sits above the red.
  const red = createRasterLayer({ dataUrl: RED, width: 4, height: 4, x: 0, y: 0 }, 'Red');
  const blue = createRasterLayer({ dataUrl: BLUE, width: 4, height: 4, x: 0, y: 2 }, 'Blue');
  return { doc: addNode(addNode(base, red), blue), bottomId: red.id, topId: blue.id };
}

function render(doc: DrawingDocument) {
  const factory = fakeSurfaceFactory();
  const target = factory(doc.canvas.width, doc.canvas.height);
  const ctx = target.getContext('2d')!;
  renderDocument(ctx, doc, {
    createSurface: factory,
    // The fake bitmaps stand in for decoded images; the compositor only ever
    // hands one to `drawImage`, which the fake context understands.
    bitmaps: new Map<string, CanvasImageSource>([
      [RED, fakeBitmap(200, 0, 0, 255) as unknown as CanvasImageSource],
      [BLUE, fakeBitmap(0, 0, 200, 255) as unknown as CanvasImageSource],
    ]),
  });
  return target;
}

describe('an adjustment layer in the stack', () => {
  it('corrects the layers below it and not the ones above', () => {
    const { doc, bottomId } = layered();
    const parent = findNode(doc.root, bottomId)!;
    expect(parent).toBeTruthy();

    // Inserted directly above the red layer, so the red is corrected and the
    // blue above it is not. This is the property that distinguishes an
    // adjustment layer from a document-wide filter.
    const adjustment = createAdjustmentLayer('grayscale');
    const index = doc.root.children.findIndex((c) => c.id === bottomId);
    const withAdjustment = addNode(doc, adjustment, { parentId: doc.root.id, index });

    const before = render(doc);
    const after = render(withAdjustment);

    // Row 0 is red only; row 3 is blue over red.
    expect(pixelAt(before, 0, 0)[0]).toBeGreaterThan(pixelAt(before, 0, 0)[2]);
    const grey = pixelAt(after, 0, 0);
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    // The blue layer sits above the adjustment and is untouched.
    expect(pixelAt(after, 0, 3)).toEqual(pixelAt(before, 0, 3));
  });

  it('does nothing at all when its settings are the identity', () => {
    const { doc } = layered();
    const plain = render(doc);
    const withNeutral = render(addNode(doc, createAdjustmentLayer('levels')));
    expect([...withNeutral.data]).toEqual([...plain.data]);
  });

  it('applies at the strength its opacity asks for', () => {
    const { doc, bottomId } = layered();
    const index = doc.root.children.findIndex((c) => c.id === bottomId);
    const adjustment = createAdjustmentLayer('grayscale');
    const half = addNode(doc, adjustment, { parentId: doc.root.id, index });
    const full = render(half);
    const mixed = render(setNodeProps(half, adjustment.id, { opacity: 0.5 }));

    const fullGrey = pixelAt(full, 0, 0);
    const halfGrey = pixelAt(mixed, 0, 0);
    // Half way between the red original and the fully desaturated version.
    expect(halfGrey[0]).toBeGreaterThan(fullGrey[0]);
    expect(halfGrey[0]).toBeLessThan(200);
  });

  it('is skipped along with everything else when it is hidden', () => {
    const { doc } = layered();
    const adjustment = createAdjustmentLayer('grayscale');
    const shown = addNode(doc, adjustment);
    const hidden = setNodeProps(shown, adjustment.id, { visible: false });
    expect([...render(hidden).data]).toEqual([...render(doc).data]);
  });
});

// ---------------------------------------------------------------------------
// Storage and export
// ---------------------------------------------------------------------------

describe('an adjustment layer in a file', () => {
  it('round-trips through the stored body', () => {
    const layer = createAdjustmentLayer('levels');
    const doc = patchAdjustment(addNode(createDocument(), layer), layer.id, { gamma: 2.2, inputBlack: 12 });

    const reopened = parseDocument(serializeDocument(doc))!;
    const restored = findNode(reopened.root, layer.id);
    expect(restored?.type).toBe('adjustment');
    expect(restored?.type === 'adjustment' && restored.adjustment).toMatchObject({
      kind: 'levels', gamma: 2.2, inputBlack: 12,
    });
  });

  it('repairs a stored spec whose fields are missing or nonsense', () => {
    // A body has been through a network, a cipher and possibly a hand edit. A
    // gamma of zero would divide by itself and blacken the drawing.
    const raw = JSON.stringify({
      ...createDocument(),
      root: {
        type: 'stack', name: 'Root', children: [
          { type: 'adjustment', id: 'a1', name: 'Bad', adjustment: { kind: 'levels', gamma: 0, inputWhite: 'x' } },
        ],
      },
    });
    const restored = findNode(parseDocument(raw)!.root, 'a1');
    expect(restored?.type === 'adjustment' && restored.adjustment.kind === 'levels' && restored.adjustment.gamma)
      .toBeGreaterThan(0);
  });

  it('writes the correction into the SVG export as a filter over what is below', () => {
    const { doc, bottomId } = layered();
    const index = doc.root.children.findIndex((c) => c.id === bottomId);
    const svg = documentToSvg(addNode(doc, createAdjustmentLayer('grayscale'), { parentId: doc.root.id, index }));

    // SVG has no "correct what is behind me", so the exporter wraps the markup
    // it has already produced. Without the sRGB hint the filter would run in
    // linearRGB and come out visibly different from the canvas.
    expect(svg).toContain('<feColorMatrix type="matrix"');
    expect(svg).toContain('color-interpolation-filters="sRGB"');
    expect(svg).toMatch(/<g filter="url\(#adj-\d+\)">/);
  });

  it('writes a LUT adjustment as a component transfer with a full table', () => {
    const layer = createAdjustmentLayer('posterize');
    const doc = addNode(createDocument({ canvas: { width: 8, height: 8 } }), createRasterLayer(
      { dataUrl: RED, width: 8, height: 8, x: 0, y: 0 }, 'Red',
    ));
    const svg = documentToSvg(addNode(doc, layer));

    expect(svg).toContain('<feComponentTransfer>');
    const table = /tableValues="([^"]+)"/.exec(svg);
    // 256 entries, not a sample of them: interpolating between a handful would
    // round the steps off a posterize, which is the one thing it is for.
    expect(table?.[1].split(' ')).toHaveLength(256);
  });

  it('splits a masked adjustment into the original and a corrected copy', () => {
    // Fading a filtered group fades it towards nothing; the picture has to fade
    // towards its own uncorrected self, which takes two layers.
    const layer = createAdjustmentLayer('grayscale');
    const { doc, bottomId } = layered();
    const index = doc.root.children.findIndex((c) => c.id === bottomId);
    const placed = addNode(doc, layer, { parentId: doc.root.id, index });
    const masked = setNodeProps(placed, layer.id, { opacity: 0.4 });

    const svg = documentToSvg(masked);
    expect(svg).toMatch(/<g filter="url\(#adj-\d+\)" opacity="0\.4">/);
  });

  it('takes a clipping mask from the layer below, as the compositor does', () => {
    const { doc, bottomId } = layered();
    const index = doc.root.children.findIndex((c) => c.id === bottomId);
    const layer = createAdjustmentLayer('grayscale');
    const placed = addNode(doc, layer, { parentId: doc.root.id, index });
    const clipped = setNodeProps(placed, layer.id, { mask: createMask('clipping') });

    // `mask-type:alpha` is SVG's only way of saying "the shape of what is
    // underneath", which is what a clipping mask means.
    expect(documentToSvg(clipped)).toContain('style="mask-type:alpha"');
  });
});
