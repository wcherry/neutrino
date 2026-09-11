/**
 * SVG import — redesign phase 5.
 *
 * The claim being tested is that an imported SVG is **editable**, not merely
 * visible: a rectangle comes in as a rectangle with a corner radius you can
 * change, a `<path>` as anchors you can drag, a `<text>` as text you can retype,
 * and a `<use>` as an instance of a symbol rather than as a flattened copy. A
 * reader that turned everything into one raster layer would pass a "does it look
 * right" test and fail every one of these.
 *
 * The `d` parser gets the most attention, because path data is where SVG in the
 * wild is least well-behaved — implicit repeated commands, arc flags that run
 * together with the numbers after them, numbers with no separator at all — and
 * each of those has a specific wrong answer that still draws *something*.
 */

import { describe, it, expect } from 'vitest';

import { parsePathData } from '../../app/(apps)/drawing/editor/io/svg/pathData';
import { parseTransform } from '../../app/(apps)/drawing/editor/io/svg/transform';
import { readSvg, SvgReadError } from '../../app/(apps)/drawing/editor/io/svg';
import { flattenTree } from '../../app/(apps)/drawing/editor/document/tree';
import { measureContour } from '../../app/(apps)/drawing/editor/document/path';
import { IDENTITY } from '../../app/(apps)/drawing/editor/document/types';
import type { DrawingNode, VectorObject } from '../../app/(apps)/drawing/editor/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function svg(body: string, attrs = 'width="200" height="100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
}

/** Every vector object in the document, whatever layer it landed in. */
function objectsIn(root: DrawingNode): VectorObject[] {
  const out: VectorObject[] = [];
  const walk = (node: DrawingNode): void => {
    if (node.type === 'vector') out.push(...node.objects);
    if (node.type === 'stack') node.children.forEach(walk);
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Path data
// ---------------------------------------------------------------------------

describe('parsing path data', () => {
  it('reads absolute and relative line commands', () => {
    const [contour] = parsePathData('M 10 10 L 20 10 l 0 10 H 40 V 40 Z');

    expect(contour.closed).toBe(true);
    expect(contour.points.map((p) => [p.x, p.y])).toEqual([
      [10, 10], [20, 10], [20, 20], [40, 20], [40, 40],
    ]);
  });

  it('continues an implicit repeat of M as L, not as a second move', () => {
    // The classic wrong answer: reading each pair after `M` as another move,
    // which draws a series of disconnected points instead of a polyline.
    const contours = parsePathData('M 0 0 10 0 20 0');
    expect(contours).toHaveLength(1);
    expect(contours[0].points).toHaveLength(3);
  });

  it('repeats a curve command for each further set of arguments', () => {
    const [contour] = parsePathData('M 0 0 C 10 0 20 0 30 0 40 0 50 0 60 0');
    expect(contour.points).toHaveLength(3);
    expect(contour.points[1].out).toEqual({ x: 40, y: 0 });
  });

  it('reads numbers with no separator between them', () => {
    // `M1.5.5` is two numbers, because the second decimal point ends the first.
    const [contour] = parsePathData('M1.5.5L2.5.5');
    expect(contour.points[0]).toMatchObject({ x: 1.5, y: 0.5 });
    expect(contour.points[1]).toMatchObject({ x: 2.5, y: 0.5 });
  });

  it('reads arc flags that run together with the numbers after them', () => {
    // `011 1` is flags 0 and 1, then the point (1, 1). Reading the flags as
    // general numbers swallows the digits and silently draws a different arc.
    const [contour] = parsePathData('M 0 0 a 1 1 0 011 1');
    const last = contour.points[contour.points.length - 1];
    expect(last.x).toBeCloseTo(1);
    expect(last.y).toBeCloseTo(1);
  });

  it('converts an arc into cubics that land on the commanded endpoint', () => {
    const [contour] = parsePathData('M 0 50 A 50 50 0 0 1 100 50');
    const last = contour.points[contour.points.length - 1];
    // Accumulated trigonometric error here shows up as a visible gap in a
    // closed shape built from arcs, so the last piece ends exactly.
    expect(last.x).toBeCloseTo(100, 6);
    expect(last.y).toBeCloseTo(50, 6);

    // …and the curve really does bulge, rather than collapsing to a chord.
    const measured = measureContour(contour);
    expect(measured.total).toBeGreaterThan(120);
  });

  it('draws a straight line for an arc with a zero radius, as the spec requires', () => {
    const [contour] = parsePathData('M 0 0 A 0 0 0 0 1 10 10');
    const last = contour.points[contour.points.length - 1];
    expect(last).toMatchObject({ x: 10, y: 10 });
  });

  it('converts a quadratic to the cubic that draws the same curve', () => {
    const [contour] = parsePathData('M 0 0 Q 50 100 100 0');
    // The standard two-thirds rule: control points at 2/3 of the way from each
    // endpoint towards the quadratic's single control point.
    expect(contour.points[0].out!.x).toBeCloseTo(100 / 3, 9);
    expect(contour.points[0].out!.y).toBeCloseTo(200 / 3, 9);
    expect(contour.points[1].in!.x).toBeCloseTo(100 - 100 / 3, 9);
    expect(contour.points[1].in!.y).toBeCloseTo(200 / 3, 9);
  });

  it('reflects the previous control point for S and T', () => {
    const [contour] = parsePathData('M 0 0 C 10 10 20 10 30 0 S 50 -10 60 0');
    // The reflection of (20, 10) through (30, 0).
    expect(contour.points[1].out).toEqual({ x: 40, y: -10 });
  });

  it('starts a new contour at each move', () => {
    const contours = parsePathData('M 0 0 L 10 0 Z M 20 0 L 30 0 Z');
    expect(contours).toHaveLength(2);
    expect(contours.every((c) => c.closed)).toBe(true);
  });

  it('keeps what it parsed when the tail is malformed', () => {
    // A bad tail costs the rest of one shape, never the file.
    const [contour] = parsePathData('M 0 0 L 10 0 L');
    expect(contour.points).toHaveLength(2);
  });

  it('returns nothing for data it cannot start reading', () => {
    expect(parsePathData('')).toEqual([]);
    expect(parsePathData('10 20 30')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

describe('parsing a transform attribute', () => {
  it('reads a matrix straight through', () => {
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
  });

  it('applies a one-argument translate along x, and a one-argument scale uniformly', () => {
    expect(parseTransform('translate(10)')).toEqual({ ...IDENTITY, e: 10, f: 0 });
    expect(parseTransform('scale(2)')).toEqual({ ...IDENTITY, a: 2, d: 2 });
  });

  it('composes a list left to right', () => {
    const t = parseTransform('translate(10 0) scale(2)');
    // The translate applies outside the scale, so a point at x=1 lands at 12
    // rather than at 22.
    expect(t.a).toBe(2);
    expect(t.e).toBe(10);
  });

  it('rotates about a given point', () => {
    const t = parseTransform('rotate(90 50 50)');
    // (50, 50) is the fixed point.
    expect(t.a * 50 + t.c * 50 + t.e).toBeCloseTo(50);
    expect(t.b * 50 + t.d * 50 + t.f).toBeCloseTo(50);
  });

  it('skips an operation it cannot read rather than dropping the whole attribute', () => {
    // A stray unit turns up often enough to matter; losing one operation
    // misplaces an object slightly, losing the attribute puts it at the origin.
    const t = parseTransform('translate(10px) scale(3)');
    expect(t.a).toBe(3);
  });

  it('is the identity for an absent attribute', () => {
    expect(parseTransform(null)).toEqual(IDENTITY);
    expect(parseTransform('')).toEqual(IDENTITY);
  });
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

describe('importing an SVG document', () => {
  it('takes the canvas from width and height, and falls back to the viewBox', () => {
    expect(readSvg(svg('<rect width="10" height="10"/>')).document.canvas)
      .toMatchObject({ width: 200, height: 100 });

    expect(readSvg(svg('<rect width="10" height="10"/>', 'viewBox="0 0 640 480"')).document.canvas)
      .toMatchObject({ width: 640, height: 480 });
  });

  it('brings shapes in as editable objects, not as pixels', () => {
    const { document } = readSvg(svg(`
      <rect x="10" y="20" width="30" height="40" rx="5" fill="#ff0000" stroke="#0000ff" stroke-width="3"/>
      <circle cx="100" cy="50" r="20"/>
      <line x1="0" y1="0" x2="10" y2="10"/>
    `));

    const objects = objectsIn(document.root);
    expect(objects.map((o) => o.kind).sort()).toEqual(['ellipse', 'line', 'rect']);

    const rect = objects.find((o) => o.kind === 'rect')!;
    expect(rect.frame).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(rect.style).toMatchObject({ fill: '#ff0000', stroke: '#0000ff', strokeWidth: 3 });
    if (rect.kind !== 'rect') throw new Error('expected a rect');
    expect(rect.cornerRadius).toBe(5);

    const circle = objects.find((o) => o.kind === 'ellipse')!;
    expect(circle.frame).toEqual({ x: 80, y: 30, width: 40, height: 40 });
  });

  it('inherits paint from an enclosing group', () => {
    // `<g fill="red">` around an unpainted child is how a great many files are
    // written; reading only the element's own attributes turns them all black.
    const { document } = readSvg(svg('<g fill="#00ff00"><rect width="10" height="10"/></g>'));
    expect(objectsIn(document.root)[0].style.fill).toBe('#00ff00');
  });

  it('prefers a style declaration over the presentation attribute', () => {
    // CSS's own order. Getting it backwards means a shape that is one colour in
    // a browser and another here.
    const { document } = readSvg(svg('<rect width="10" height="10" fill="#ff0000" style="fill:#0000ff"/>'));
    expect(objectsIn(document.root)[0].style.fill).toBe('#0000ff');
  });

  it('folds a translate into the geometry so the shape stays editable', () => {
    const { document } = readSvg(svg('<rect x="0" y="0" width="10" height="10" transform="translate(50 60)"/>'));
    const rect = objectsIn(document.root)[0];

    // Absorbed, not worn: the frame moved and the object is still a plain rect.
    expect(rect.frame).toEqual({ x: 50, y: 60, width: 10, height: 10 });
  });

  it('puts a rotated shape in a layer that wears the matrix', () => {
    const { document } = readSvg(svg('<rect x="0" y="0" width="10" height="10" transform="rotate(30)"/>'));
    const layer = flattenTree(document.root).find((f) => f.node.type === 'vector' && f.node.objects.length === 1)!.node;

    // Flattening the matrix into the geometry would turn an editable rectangle
    // into a four-point path, so the layer carries it instead.
    expect(layer.transform).not.toEqual(IDENTITY);
    if (layer.type !== 'vector') throw new Error('expected a vector layer');
    expect(layer.objects[0].kind).toBe('rect');
  });

  it('maps a group to a stack and keeps paint order', () => {
    const { document } = readSvg(svg(`
      <g id="under"><rect width="10" height="10"/></g>
      <g id="over"><rect width="10" height="10"/></g>
    `));

    // SVG paints in document order and `children[0]` is the top, so the later
    // group is the first child.
    expect(document.root.children.map((c) => c.name)).toEqual(['over', 'under']);
    expect(document.root.children.every((c) => c.type === 'stack')).toBe(true);
  });

  it('keeps paint order inside a group too, not just between groups', () => {
    const { document } = readSvg(svg(`
      <g id="outer">
        <g id="first"><rect width="10" height="10"/></g>
        <g id="second"><rect width="10" height="10"/></g>
      </g>
    `));

    const outer = document.root.children[0];
    if (outer.type !== 'stack') throw new Error('expected a group');
    // The later element paints on top, so it is `children[0]` here as well —
    // reversing at both levels puts every group's contents upside down, which
    // a test that only looked at the top level would not have caught.
    expect(outer.children.map((c) => c.name)).toEqual(['second', 'first']);
  });

  it('splits a run of shapes when a group interrupts it, preserving order', () => {
    const { document } = readSvg(svg(`
      <rect id="bottom" width="10" height="10"/>
      <g id="middle"><rect width="10" height="10"/></g>
      <rect id="top" width="10" height="10"/>
    `));

    // Objects live in layers in this model, so a run of loose shapes is
    // gathered into one layer and the run is broken by anything that is not a
    // shape — which costs an extra layer and keeps the stacking exact.
    const names = document.root.children.map((child) => (
      child.type === 'vector' ? child.objects[0].id : child.name
    ));
    expect(names).toEqual(['top', 'middle', 'bottom']);
  });

  it('brings text in as a text layer, with the baseline turned into a box', () => {
    const { document } = readSvg(svg(
      '<text x="20" y="60" font-family="Georgia" font-size="24" fill="#123456">Hello</text>',
    ));
    const text = flattenTree(document.root).find((f) => f.node.type === 'text')!.node;

    if (text.type !== 'text') throw new Error('expected a text layer');
    expect(text.text).toBe('Hello');
    expect(text.fontFamily).toBe('Georgia');
    expect(text.fontSize).toBe(24);
    expect(text.color).toBe('#123456');
    // SVG's `y` is a baseline; the model's box is the top edge, so the box
    // starts one font size higher or every caption sits a line too low.
    expect(text.box.y).toBe(36);
  });

  it('binds a textPath to the path it references', () => {
    const { document } = readSvg(svg(`
      <path id="curve" d="M 0 50 C 30 0 70 0 100 50" fill="none"/>
      <text><textPath href="#curve" startOffset="25%">Around</textPath></text>
    `));

    const text = flattenTree(document.root).find((f) => f.node.type === 'text')!.node;
    if (text.type !== 'text') throw new Error('expected a text layer');
    // A reference, not a copy of the geometry: the path is an ordinary object
    // in the drawing and reshaping it re-flows the caption.
    expect(text.textPath?.pathId).toBe('curve');
    expect(text.textPath?.startOffset).toBe(25);
    expect(objectsIn(document.root).some((o) => o.id === 'curve')).toBe(true);
  });

  it('drops a textPath whose target is not in the document', () => {
    const { document } = readSvg(svg('<text><textPath href="#missing">Nowhere</textPath></text>'));
    const text = flattenTree(document.root).find((f) => f.node.type === 'text')!.node;

    if (text.type !== 'text') throw new Error('expected a text layer');
    // A dangling binding would have to be guarded on every frame; laying the
    // text out in its box instead is visible and editable.
    expect(text.textPath).toBeUndefined();
  });

  it('imports <use> as instances of one shared symbol', () => {
    const { document } = readSvg(svg(`
      <defs><g id="icon"><rect width="10" height="10"/></g></defs>
      <use href="#icon" x="0" y="0"/>
      <use href="#icon" x="50" y="0"/>
      <use href="#icon" x="100" y="0"/>
    `));

    const instances = flattenTree(document.root).filter((f) => f.node.type === 'instance');
    expect(instances).toHaveLength(3);
    // Stored once and referenced, which is what redesign §4 asks of a reusable
    // object — and what lets the export write it back out the same way.
    expect(document.symbols).toHaveLength(1);
    const symbolIds = new Set(instances.map((f) => (f.node as { symbolId: string }).symbolId));
    expect(symbolIds.size).toBe(1);
  });

  it('composes a use element’s x and y onto its transform', () => {
    const { document } = readSvg(svg(`
      <defs><g id="icon"><rect width="10" height="10"/></g></defs>
      <use href="#icon" x="40" y="25"/>
    `));

    const instance = flattenTree(document.root).find((f) => f.node.type === 'instance')!.node;
    expect(instance.transform.e).toBe(40);
    expect(instance.transform.f).toBe(25);
  });

  it('refuses to follow a use element that refers to itself', () => {
    const { skipped } = readSvg(svg(`
      <defs><g id="loop"><use href="#loop"/></g></defs>
      <use href="#loop"/>
    `));
    // Terminating rather than recursing until the stack runs out.
    expect(skipped).toContain('self-referencing <use>');
  });

  it('embeds a data: image and refuses to fetch an external one', () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const embedded = readSvg(svg(`<image href="${pixel}" x="1" y="2" width="8" height="9"/>`));
    const layer = flattenTree(embedded.document.root).find((f) => f.node.type === 'raster')!.node;
    if (layer.type !== 'raster') throw new Error('expected a raster layer');
    expect(layer.source).toMatchObject({ x: 1, y: 2, width: 8, height: 9 });

    const linked = readSvg(svg('<image href="https://example.com/x.png" width="8" height="9"/>'));
    // A document is not a place from which to go and get things, and a layer
    // pointing at somebody's server breaks the moment the drawing is shared.
    expect(flattenTree(linked.document.root).some((f) => f.node.type === 'raster')).toBe(false);
    expect(linked.skipped).toContain('externally linked <image>');
  });

  it('reports what it could not represent instead of failing', () => {
    const { document, skipped } = readSvg(svg(`
      <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
      <rect width="10" height="10" fill="url(#g)"/>
      <rect width="10" height="10" fill="#00ff00"/>
    `));

    expect(skipped).toContain('gradient or pattern fill');
    // The rest of the file still arrives — an SVG is usually somebody's whole
    // artwork, and losing a gradient beats losing the drawing.
    expect(objectsIn(document.root)).toHaveLength(2);
  });

  it('throws only for markup that is not an SVG at all', () => {
    expect(() => readSvg('<html><body/></html>')).toThrow(SvgReadError);
    expect(() => readSvg('<svg><rect')).toThrow(SvgReadError);
  });
});
