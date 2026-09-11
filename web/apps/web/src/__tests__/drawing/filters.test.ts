/**
 * Filters and effects — redesign phase 6.
 *
 * The arithmetic is checked directly, because that is where the bugs are and
 * because none of it needs a canvas. Three of the assertions here are about
 * mistakes that are invisible in a screenshot and obvious in the numbers:
 *
 * - **a blur that was not premultiplied** grows a dark fringe along every
 *   transparent edge, which reads as a bad matte rather than as a bug;
 * - **noise drawn from `Math.random`** differs between the screen, the merged
 *   image and each layer's PNG, so the export stops being a picture of the
 *   drawing;
 * - **a chain applied in a fixed order** silently ignores the ordering the
 *   document asked for.
 */

import { describe, it, expect } from 'vitest';

import {
  addNoise,
  applyFilterChain,
  blurImage,
  dropShadow,
  filterChainToSvg,
  pixelateImage,
  sharpenImage,
  unsupportedSvgFilters,
  type ImageLike,
} from '../../app/(apps)/drawing/editor/render/imageFilters';
import {
  clampFilter,
  createFilter,
  hasActiveFilters,
  isActiveFilter,
  type FilterSpec,
} from '../../app/(apps)/drawing/editor/document/filters';
import { createDocument, createRasterLayer } from '../../app/(apps)/drawing/editor/document/factory';
import { addFilter, patchFilter, removeFilter, reorderFilter } from '../../app/(apps)/drawing/editor/document/edits';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { findNode } from '../../app/(apps)/drawing/editor/document/tree';
import { documentToSvg } from '../../app/(apps)/drawing/editor/render/documentSvg';

/** A solid square of one colour, centred in a transparent field. */
function square(size: number, blockSize: number, colour: [number, number, number, number]): ImageLike {
  const data = new Uint8ClampedArray(size * size * 4);
  const start = Math.floor((size - blockSize) / 2);
  for (let y = start; y < start + blockSize; y++) {
    for (let x = start; x < start + blockSize; x++) {
      const at = (y * size + x) * 4;
      data[at] = colour[0]; data[at + 1] = colour[1]; data[at + 2] = colour[2]; data[at + 3] = colour[3];
    }
  }
  return { data, width: size, height: size };
}

function at(image: ImageLike, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

// ---------------------------------------------------------------------------
// Blur
// ---------------------------------------------------------------------------

describe('blur', () => {
  it('spreads alpha outwards without moving the mass', () => {
    const image = square(32, 8, [255, 255, 255, 255]);
    const before = image.data.reduce((sum, _, i) => (i % 4 === 3 ? sum + image.data[i] : sum), 0);
    blurImage(image, 6);
    const after = image.data.reduce((sum, _, i) => (i % 4 === 3 ? sum + image.data[i] : sum), 0);

    // Alpha reaches past the original square…
    expect(at(image, 8, 16)[3]).toBeGreaterThan(0);
    // …and the total is preserved, which is what says the kernel is normalised
    // rather than gaining or losing weight at the edges.
    expect(after / before).toBeGreaterThan(0.9);
    expect(after / before).toBeLessThan(1.1);
  });

  it('does not darken a coloured edge against transparency', () => {
    // The premultiplication test. Blurring straight RGBA averages the colour of
    // transparent pixels — black — into the visible ones, and a white square
    // comes back with grey edges.
    const image = square(32, 10, [255, 255, 255, 255]);
    blurImage(image, 4);

    for (let x = 8; x < 24; x++) {
      const [r, g, b, a] = at(image, x, 16);
      if (a < 8) continue;
      expect(r, `pixel ${x} darkened to ${r}`).toBeGreaterThan(230);
      expect(g).toBeGreaterThan(230);
      expect(b).toBeGreaterThan(230);
    }
  });

  it('leaves the image alone at radius zero', () => {
    const image = square(16, 6, [10, 20, 30, 255]);
    const before = [...image.data];
    blurImage(image, 0);
    expect([...image.data]).toEqual(before);
  });

  it('does something at a small radius', () => {
    // The regression this exists for: one ideal box width, floored to the
    // nearest odd integer, is 1 for anything below about σ = 1.5 — and a box of
    // width 1 is the identity. Every small blur silently did nothing, which
    // looks exactly like a filter that has not been switched on.
    for (const radius of [1, 1.5, 2, 3]) {
      const image = square(16, 6, [255, 255, 255, 255]);
      const before = [...image.data];
      blurImage(image, radius);
      expect([...image.data], `radius ${radius} did nothing`).not.toEqual(before);
    }
  });

  it('spreads further for a larger radius', () => {
    const reach = (radius: number) => {
      const image = square(64, 8, [255, 255, 255, 255]);
      blurImage(image, radius);
      let furthest = 0;
      for (let x = 0; x < 64; x++) if (at(image, x, 32)[3] > 2) furthest = Math.abs(x - 32);
      return furthest;
    };
    expect(reach(8)).toBeGreaterThan(reach(3));
  });
});

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

/** An opaque field split down the middle into two colours, then softened. */
function softEdge(size: number): ImageLike {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at_ = (y * size + x) * 4;
      const value = x < size / 2 ? 40 : 210;
      data[at_] = value; data[at_ + 1] = value; data[at_ + 2] = value; data[at_ + 3] = 255;
    }
  }
  const image = { data, width: size, height: size };
  blurImage(image, 3);
  return image;
}

describe('sharpen', () => {
  it('increases the difference across a colour edge', () => {
    const image = softEdge(32);
    const before = at(image, 17, 16)[0] - at(image, 15, 16)[0];
    sharpenImage(image, 200);
    const after = at(image, 17, 16)[0] - at(image, 15, 16)[0];
    expect(Math.abs(after)).toBeGreaterThan(Math.abs(before));
  });

  it('leaves alpha alone, as its SVG equivalent does', () => {
    // `preserveAlpha="true"` on the exported `feConvolveMatrix` says the same
    // thing, and the two emitters have to agree. The consequence is that a
    // layer whose softness is in its alpha does not sharpen.
    const image = square(32, 12, [255, 255, 255, 255]);
    blurImage(image, 4);
    const alphaBefore = image.data.filter((_, i) => i % 4 === 3);
    sharpenImage(image, 200);
    expect([...image.data.filter((_, i) => i % 4 === 3)]).toEqual([...alphaBefore]);
  });
});

describe('pixelate', () => {
  it('gives every pixel in a block the same colour', () => {
    const image: ImageLike = { data: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16 };
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = (i / 4) % 256;
      image.data[i + 3] = 255;
    }
    pixelateImage(image, 4);

    const corner = at(image, 0, 0);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) expect(at(image, x, y)).toEqual(corner);
    }
    // The next block over is a different colour, or the whole thing collapsed.
    expect(at(image, 4, 0)).not.toEqual(corner);
  });

  it('averages a half-covered block towards transparency rather than darkening it', () => {
    // Dividing the premultiplied colour sums by the pixel count instead of by
    // the alpha total is the mistake here, and it comes out as a dark halo
    // around every layer edge.
    const image: ImageLike = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 4 + x) * 4;
        image.data[i] = 255; image.data[i + 1] = 255; image.data[i + 2] = 255; image.data[i + 3] = 255;
      }
    }
    pixelateImage(image, 4);
    const [r, , , a] = at(image, 0, 0);
    expect(r).toBe(255);
    expect(a).toBe(128);
  });
});

describe('drop shadow', () => {
  it('puts colour where the layer had none, under what it had', () => {
    const image = square(32, 8, [255, 255, 255, 255]);
    dropShadow(image, { dx: 6, dy: 6, blur: 2, color: '#000000', opacity: 1 });

    // The square itself is still white and still opaque.
    expect(at(image, 16, 16)[0]).toBeGreaterThan(200);
    // Down and right of it there is now something there.
    expect(at(image, 22, 22)[3]).toBeGreaterThan(0);
    expect(at(image, 22, 22)[0]).toBeLessThan(128);
  });
});

describe('noise', () => {
  it('produces the same grain every time it runs', () => {
    // The screen, the merged image and each layer PNG all render separately; a
    // seeded generator advanced in visit order would differ between them.
    const first = square(16, 16, [128, 128, 128, 255]);
    const second = square(16, 16, [128, 128, 128, 255]);
    addNoise(first, 40, true);
    addNoise(second, 40, true);
    expect([...first.data]).toEqual([...second.data]);
  });

  it('moves the three channels together when it is monochrome', () => {
    const mono = square(8, 8, [128, 128, 128, 255]);
    addNoise(mono, 50, true);
    const [r, g, b] = at(mono, 4, 4);
    expect(r).toBe(g);
    expect(g).toBe(b);

    const colour = square(8, 8, [128, 128, 128, 255]);
    addNoise(colour, 50, false);
    const [cr, cg] = at(colour, 4, 4);
    expect(cr).not.toBe(cg);
  });
});

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

describe('the filter chain', () => {
  it('applies in the document order, so order is a parameter', () => {
    // A colour edge rather than a shape: sharpen preserves alpha, so a chain
    // over a binary silhouette would come out the same either way and prove
    // nothing about ordering.
    const blurThenSharpen = softEdge(32);
    const sharpenThenBlur: ImageLike = {
      data: new Uint8ClampedArray(blurThenSharpen.data),
      width: 32,
      height: 32,
    };
    const blur = { ...createFilter('blur'), radius: 6 } as FilterSpec;
    const sharpen = { ...createFilter('sharpen'), amount: 150 } as FilterSpec;

    applyFilterChain(blurThenSharpen, [blur, sharpen]);
    applyFilterChain(sharpenThenBlur, [sharpen, blur]);
    expect([...blurThenSharpen.data]).not.toEqual([...sharpenThenBlur.data]);
  });

  it('skips a disabled filter entirely', () => {
    const image = square(16, 6, [255, 255, 255, 255]);
    const before = [...image.data];
    applyFilterChain(image, [{ ...createFilter('blur'), radius: 10, enabled: false } as FilterSpec]);
    expect([...image.data]).toEqual(before);
  });

  it('treats a zero-strength filter as inactive', () => {
    expect(isActiveFilter({ ...createFilter('blur'), radius: 0 } as FilterSpec)).toBe(false);
    expect(hasActiveFilters([{ ...createFilter('noise'), amount: 0 } as FilterSpec])).toBe(false);
    expect(hasActiveFilters([createFilter('glow')])).toBe(true);
  });

  it('clamps a radius that would take minutes to compute', () => {
    const clamped = clampFilter({ ...createFilter('blur'), radius: 1e6 } as FilterSpec);
    expect(clamped.kind === 'blur' && clamped.radius).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// On a layer
// ---------------------------------------------------------------------------

function withLayer() {
  const layer = createRasterLayer(
    { dataUrl: 'data:image/png;base64,x', width: 8, height: 8, x: 0, y: 0 },
    'Photo',
  );
  const doc = { ...createDocument(), root: { ...createDocument().root, children: [layer] } };
  return { doc, layerId: layer.id };
}

describe('a filter on a layer', () => {
  it('round-trips through the stored body, in order', () => {
    const { doc, layerId } = withLayer();
    const blur = createFilter('blur');
    const noise = createFilter('noise');
    const edited = addFilter(addFilter(doc, layerId, blur), layerId, noise);

    const reopened = parseDocument(serializeDocument(edited))!;
    const layer = findNode(reopened.root, layerId);
    expect(layer?.filters?.map((f) => f.kind)).toEqual(['blur', 'noise']);
  });

  it('drops the field entirely when the last filter goes', () => {
    // A layer that has never had a filter and one that no longer has any must
    // serialise the same way, or every layer ever touched carries an empty array.
    const { doc, layerId } = withLayer();
    const filter = createFilter('blur');
    const removed = removeFilter(addFilter(doc, layerId, filter), layerId, filter.id);
    expect(findNode(removed.root, layerId)).not.toHaveProperty('filters');
  });

  it('reorders within the chain and clamps at the ends', () => {
    const { doc, layerId } = withLayer();
    const a = createFilter('blur');
    const b = createFilter('sharpen');
    const both = addFilter(addFilter(doc, layerId, a), layerId, b);

    const moved = reorderFilter(both, layerId, b.id, -1);
    expect(findNode(moved.root, layerId)?.filters?.map((f) => f.kind)).toEqual(['sharpen', 'blur']);
    // Already first; moving it earlier again changes nothing.
    const again = reorderFilter(moved, layerId, b.id, -1);
    expect(again).toBe(moved);
  });

  it('clamps a patched value rather than storing it', () => {
    const { doc, layerId } = withLayer();
    const filter = createFilter('blur');
    const edited = patchFilter(addFilter(doc, layerId, filter), layerId, filter.id, { radius: 9999 } as never);
    const stored = findNode(edited.root, layerId)?.filters?.[0];
    expect(stored?.kind === 'blur' && stored.radius).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

describe('filters in an SVG export', () => {
  it('writes the four kinds the format can express', () => {
    const markup = filterChainToSvg('fx', [
      createFilter('blur'),
      createFilter('sharpen'),
      createFilter('drop-shadow'),
      createFilter('glow'),
    ])!;
    expect(markup).toContain('<feGaussianBlur');
    expect(markup).toContain('<feConvolveMatrix');
    expect(markup).toContain('<feDropShadow');
    // sRGB, or the filter runs in linearRGB and comes out different from canvas.
    expect(markup).toContain('color-interpolation-filters="sRGB"');
  });

  it('skips the two it cannot, and says which', () => {
    // SVG has no block-average primitive and `feTurbulence` is Perlin noise
    // rather than per-pixel grain. Approximating either would be a different
    // picture under the same name.
    expect(filterChainToSvg('fx', [createFilter('pixelate'), createFilter('noise')])).toBeNull();
    expect(unsupportedSvgFilters([createFilter('pixelate'), createFilter('blur')])).toEqual(['pixelate']);
  });

  it('hangs the filter off the layer group it belongs to', () => {
    const { doc, layerId } = withLayer();
    const svg = documentToSvg(addFilter(doc, layerId, createFilter('blur')));
    expect(svg).toMatch(/filter="url\(#fx-\d+\)"/);
    expect(svg).toContain('<feGaussianBlur');
  });
});
