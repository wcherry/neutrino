/**
 * Cubic paths — the geometry phase 5's editable shapes rest on.
 *
 * The model gained control handles, and the property that matters most is that
 * **the old shape still parses and still draws**: a `PathObject` whose points
 * are bare `{x, y}` is a polyline, exactly as it was before handles existed, and
 * every drawing saved before this must keep working. That is asserted first.
 *
 * After that, the arithmetic: flattening a curve for hit testing and bounds,
 * measuring it by arc length so text can be laid along it, and emitting it as
 * `d` — where the specific risk is a curve that draws in one place and answers
 * clicks in another.
 */

import { describe, it, expect } from 'vitest';

import {
  contourToPathData,
  distanceToPath,
  flattenContour,
  flattenPath,
  mapPathObject,
  measureContour,
  pathBounds,
  pathToPathData,
  pointInContour,
  positionAt,
} from '../../app/(apps)/drawing/editor/document/path';
import { createPath } from '../../app/(apps)/drawing/editor/document/factory';
import { vectorObjectBounds } from '../../app/(apps)/drawing/editor/document/geometry';
import { hitTestObject } from '../../app/(apps)/drawing/editor/render/vectorObject';
import { pathContours, type PathObject, type SubPath } from '../../app/(apps)/drawing/editor/types';

/** A quarter-circle-ish curve from (0,0) to (100,100), bulging right. */
function curve(): PathObject {
  return createPath(
    [
      { x: 0, y: 0, out: { x: 100, y: 0 } },
      { x: 100, y: 100, in: { x: 100, y: 0 } },
    ],
    { strokeWidth: 0 },
  );
}

/** A straight polyline, in the shape every drawing written before handles has. */
function polyline(): PathObject {
  return createPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], { strokeWidth: 0 });
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

describe('a path with no handles', () => {
  it('is still a polyline, flattened to exactly its own points', () => {
    // The compatibility guarantee: `PathPoint` extends `Point`, so nothing
    // stored before this needed migrating, and nothing about it draws
    // differently.
    expect(flattenContour({ points: polyline().points, closed: false }))
      .toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
  });

  it('emits straight-line commands rather than degenerate curves', () => {
    // `L` and not `C`: a freehand stroke of two thousand points is a third the
    // size this way, and readable in a diff.
    const d = contourToPathData({ points: polyline().points, closed: false });
    expect(d).toBe('M 0 0 L 100 0 L 100 50');
    expect(d).not.toContain('C');
  });

  it('has exactly one contour', () => {
    expect(pathContours(polyline())).toHaveLength(1);
    expect(polyline().subpaths).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

describe('flattening a curve', () => {
  it('starts and ends on the anchors', () => {
    const points = flattenContour({ points: curve().points, closed: false });
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1].x).toBeCloseTo(100);
    expect(points[points.length - 1].y).toBeCloseTo(100);
  });

  it('subdivides a long curve more finely than a short one', () => {
    const short = flattenContour({ points: curve().points, closed: false });
    const long = flattenContour({
      points: mapPathObject(curve(), (p) => ({ x: p.x * 10, y: p.y * 10 })).points,
      closed: false,
    });
    // Adaptive by chord length: a fixed step count is invisible on a 20px curve
    // and visibly faceted on a 2000px one, and a drawing has both.
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('does not repeat the first anchor when a contour closes', () => {
    const closed = flattenContour({ points: polyline().points, closed: true });
    // A duplicated point is a zero-length final span, which reads as a
    // divide-by-zero everywhere lengths are normalised.
    expect(closed[closed.length - 1]).not.toEqual(closed[0]);
  });

  it('returns one polyline per contour', () => {
    const path = createPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], undefined, {
      closed: true,
      subpaths: [{ points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }], closed: true }],
    });
    expect(flattenPath(path)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe('a path’s extent', () => {
  it('is measured from the drawn curve, not from the control points', () => {
    const bounds = pathBounds(curve());
    // The handle sits at (100, 0) but the curve never reaches x = 100 until its
    // endpoint, so a box around the control polygon would be visibly larger
    // than the stroke it frames.
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.width).toBeLessThanOrEqual(100.01);
    expect(bounds.height).toBeLessThanOrEqual(100.01);
  });

  it('covers every contour', () => {
    const path = createPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], { strokeWidth: 0 }, {
      subpaths: [{ points: [{ x: 40, y: 40 }, { x: 60, y: 60 }], closed: false }],
    });
    const bounds = pathBounds(path);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(60);
    expect(bounds.height).toBeCloseTo(60);
  });

  it('is what the object’s own bounding box is built from, stroke included', () => {
    const thick = createPath([{ x: 10, y: 10 }, { x: 50, y: 10 }], { strokeWidth: 8 });
    const bounds = vectorObjectBounds(thick);
    // Half the stroke on each side, or the layer's PNG is clipped on export by
    // exactly that much.
    expect(bounds.y).toBeCloseTo(6);
    expect(bounds.height).toBeCloseTo(8);
  });
});

// ---------------------------------------------------------------------------
// Measuring and walking
// ---------------------------------------------------------------------------

describe('measuring a path by arc length', () => {
  it('measures a straight run exactly', () => {
    const measured = measureContour({ points: [{ x: 0, y: 0 }, { x: 30, y: 40 }], closed: false });
    expect(measured.total).toBeCloseTo(50);
  });

  it('includes the closing span of a closed contour', () => {
    const square: SubPath = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      closed: true,
    };
    expect(measureContour(square).total).toBeCloseTo(40);
  });

  it('finds the point and direction at a distance along', () => {
    const measured = measureContour({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false });
    const at = positionAt(measured, 25);

    expect(at.point.x).toBeCloseTo(25);
    expect(at.point.y).toBeCloseTo(0);
    expect(at.angle).toBeCloseTo(0);
  });

  it('clamps past either end rather than wrapping', () => {
    const measured = measureContour({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false });
    // Text that ran off a circle and reappeared over its own beginning would
    // overlap itself illegibly; clamping puts the overflow where it is visible.
    expect(positionAt(measured, 5000).point.x).toBeCloseTo(100);
    expect(positionAt(measured, -50).point.x).toBeCloseTo(0);
  });

  it('answers something usable for a degenerate path', () => {
    const measured = measureContour({ points: [{ x: 7, y: 9 }], closed: false });
    expect(measured.total).toBe(0);
    expect(positionAt(measured, 10).point).toEqual({ x: 7, y: 9 });
  });
});

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

describe('hit testing a path', () => {
  it('measures against the curve, not against the anchors', () => {
    const object = curve();
    const measured = measureContour({ points: object.points, closed: false });
    const midpoint = positionAt(measured, measured.total / 2).point;

    // Testing anchors alone left the whole middle of a long bézier span
    // unclickable — hidden until now by the freehand pen's dense spacing.
    expect(distanceToPath(object, midpoint)).toBeLessThan(1);
    expect(hitTestObject(object, midpoint)).toBe(true);
  });

  it('does not catch a click inside the loop of an unfilled stroke', () => {
    const loop = createPath(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      { fill: 'none', strokeWidth: 2 },
      { closed: true },
    );
    // The box of a long scribble covers most of the canvas; filling in for it
    // would make it swallow every click on the page.
    expect(hitTestObject(loop, { x: 50, y: 50 })).toBe(false);
  });

  it('does catch a click inside a filled closed path', () => {
    const filled = createPath(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      { fill: '#ff0000', strokeWidth: 2 },
      { closed: true },
    );
    // Its interior is painted, so its interior is clickable.
    expect(hitTestObject(filled, { x: 50, y: 50 })).toBe(true);
  });

  it('knows what is inside a closed contour', () => {
    const square: SubPath = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      closed: true,
    };
    expect(pointInContour(square, { x: 5, y: 5 })).toBe(true);
    expect(pointInContour(square, { x: 15, y: 5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

describe('transforming a path', () => {
  it('moves handles with their anchors', () => {
    const moved = mapPathObject(curve(), (p) => ({ x: p.x + 10, y: p.y + 20 }));

    expect(moved.points[0]).toEqual({ x: 10, y: 20, out: { x: 110, y: 20 } });
    // Handles are stored absolute precisely so this needs no special case —
    // leaving them behind turns a smooth curve inside out.
    expect(moved.points[1].in).toEqual({ x: 110, y: 20 });
  });

  it('covers every contour, not just the first', () => {
    const path = createPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], undefined, {
      subpaths: [{ points: [{ x: 5, y: 5 }, { x: 6, y: 6 }], closed: false }],
    });
    const moved = mapPathObject(path, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    expect(moved.subpaths![0].points[0]).toEqual({ x: 10, y: 10 });
  });
});

describe('emitting path data', () => {
  it('writes a cubic for a curved span', () => {
    expect(pathToPathData(curve())).toBe('M 0 0 C 100 0 100 0 100 100');
  });

  it('closes a closed contour and joins several with one d', () => {
    const path = createPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], undefined, {
      closed: true,
      subpaths: [{ points: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }], closed: true }],
    });
    const d = pathToPathData(path);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(d.match(/M/g)).toHaveLength(2);
  });
});
