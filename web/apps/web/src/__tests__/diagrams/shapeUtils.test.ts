/**
 * Tests for shape utility functions.
 *
 * Covers:
 * - getBoundingBox returns correct bounding rect for a set of shapes
 * - snapToGrid rounds coordinates to nearest grid increment
 * - getShapeAtPoint returns hit shape or null
 * - isShapeInRect correctly identifies shapes inside a selection rect
 */

import { describe, it, expect } from 'vitest';
import {
  getBoundingBox,
  snapToGrid,
  getShapeAtPoint,
  isShapeInRect,
} from '../../app/(apps)/diagrams/editor/utils/shapeUtils';
import type { DiagramShape } from '../../app/(apps)/diagrams/types';

function makeShape(overrides: Partial<DiagramShape> = {}): DiagramShape {
  return {
    id: 'shape-1',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 120,
    height: 60,
    label: '',
    style: {
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 1,
      fontSize: 14,
      fontFamily: 'Inter',
      textColor: '#000000',
      opacity: 1,
    },
    ...overrides,
  };
}

describe('getBoundingBox', () => {
  it('returns tight bounding box for multiple shapes', () => {
    const shapes: DiagramShape[] = [
      makeShape({ id: 's1', x: 10, y: 20, width: 50, height: 30 }),
      makeShape({ id: 's2', x: 80, y: 10, width: 40, height: 60 }),
    ];
    const box = getBoundingBox(shapes);
    expect(box.x).toBe(10);
    expect(box.y).toBe(10);
    expect(box.width).toBe(110); // 80+40 - 10
    expect(box.height).toBe(60); // 10+60 - 10
  });

  it('returns the shape itself when only one shape', () => {
    const shapes = [makeShape({ x: 50, y: 60, width: 100, height: 80 })];
    const box = getBoundingBox(shapes);
    expect(box.x).toBe(50);
    expect(box.y).toBe(60);
    expect(box.width).toBe(100);
    expect(box.height).toBe(80);
  });

  it('returns zero rect when no shapes', () => {
    const box = getBoundingBox([]);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(0);
    expect(box.height).toBe(0);
  });
});

describe('snapToGrid', () => {
  it('snaps to nearest grid multiple (20px grid)', () => {
    expect(snapToGrid(23, 20)).toBe(20);
    expect(snapToGrid(31, 20)).toBe(40);
    expect(snapToGrid(20, 20)).toBe(20);
  });

  it('works with a 10px grid', () => {
    expect(snapToGrid(14, 10)).toBe(10);
    expect(snapToGrid(15, 10)).toBe(20);
    expect(snapToGrid(9, 10)).toBe(10);
  });

  it('returns 0 for value 0', () => {
    expect(snapToGrid(0, 20)).toBe(0);
  });
});

describe('getShapeAtPoint', () => {
  const shapes: DiagramShape[] = [
    makeShape({ id: 's1', x: 100, y: 100, width: 100, height: 50 }),
    makeShape({ id: 's2', x: 250, y: 200, width: 80, height: 40 }),
  ];

  it('returns hit shape when point is inside', () => {
    const hit = getShapeAtPoint(shapes, 150, 125);
    expect(hit?.id).toBe('s1');
  });

  it('returns null when point is outside all shapes', () => {
    const hit = getShapeAtPoint(shapes, 0, 0);
    expect(hit).toBeNull();
  });

  it('returns last (top) shape when shapes overlap', () => {
    const overlapping: DiagramShape[] = [
      makeShape({ id: 'bottom', x: 0, y: 0, width: 200, height: 200 }),
      makeShape({ id: 'top', x: 50, y: 50, width: 100, height: 100 }),
    ];
    const hit = getShapeAtPoint(overlapping, 100, 100);
    expect(hit?.id).toBe('top');
  });
});

describe('isShapeInRect', () => {
  it('returns true when shape is fully inside selection rect', () => {
    const shape = makeShape({ x: 50, y: 50, width: 40, height: 30 });
    expect(isShapeInRect(shape, { x: 30, y: 30, width: 100, height: 80 })).toBe(true);
  });

  it('returns false when shape is fully outside selection rect', () => {
    const shape = makeShape({ x: 200, y: 200, width: 40, height: 30 });
    expect(isShapeInRect(shape, { x: 30, y: 30, width: 100, height: 80 })).toBe(false);
  });

  it('returns false when shape only partially overlaps (lasso requires full containment)', () => {
    const shape = makeShape({ x: 80, y: 80, width: 80, height: 60 });
    expect(isShapeInRect(shape, { x: 30, y: 30, width: 100, height: 80 })).toBe(false);
  });
});
