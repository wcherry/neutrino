/**
 * The diagram geometry shared by the embedded viewer and the Slides PDF export.
 *
 * The viewer draws a page as JSX and the export draws it as markup, so the two
 * have to come out of the same paths and the same view box — these pin that
 * down, and pin down that the markup is escaped, since a shape label is
 * whatever someone typed.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@neutrino/api-diagrams', () => ({ diagramsApi: { getDiagram: vi.fn() } }));

import {
  computeViewBox,
  connectorLabelAnchor,
  diagramPageToSvg,
  getConnectorPoints,
  getShapePath,
} from '@/app/(apps)/diagrams/editor/diagramSvg';
import type { DiagramPage, DiagramShape } from '@/app/(apps)/diagrams/types';

function shape(over: Partial<DiagramShape> = {}): DiagramShape {
  return {
    id: 'sh1',
    type: 'rectangle',
    x: 10, y: 20, width: 100, height: 50,
    label: '',
    style: {
      fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1,
      fontSize: 12, fontFamily: 'Inter', textColor: '#111111',
    },
    ...over,
  } as DiagramShape;
}

function page(over: Partial<DiagramPage> = {}): DiagramPage {
  return { id: 'p1', name: 'Page 1', shapes: [], connectors: [], ...over } as DiagramPage;
}

describe('getShapePath', () => {
  it('closes a rectangle around the shape box', () => {
    expect(getShapePath(shape())).toBe('M 10 20 H 110 V 70 H 10 Z');
  });

  it('draws a diamond through the midpoints of the box', () => {
    expect(getShapePath(shape({ type: 'diamond' }))).toBe('M 60 20 L 110 45 L 60 70 L 10 45 Z');
  });
});

describe('computeViewBox', () => {
  it('pads the bounding box of the shapes', () => {
    expect(computeViewBox(page({ shapes: [shape()] }))).toBe('-10 0 140 90');
  });

  it('has a size to draw into when the page is empty', () => {
    expect(computeViewBox(page())).toBe('0 0 400 300');
  });
});

describe('getConnectorPoints', () => {
  it('routes from centre to centre through the waypoints', () => {
    const a = shape({ id: 'a', x: 0, y: 0, width: 10, height: 10 });
    const b = shape({ id: 'b', x: 100, y: 100, width: 10, height: 10 });
    const points = getConnectorPoints(
      { id: 'c1', sourceId: 'a', targetId: 'b', waypoints: [{ x: 50, y: 20 }] } as never,
      [a, b],
    );
    expect(points).toBe('5,5 50,20 105,105');
    expect(connectorLabelAnchor(points)).toEqual({ x: 50, y: 14 });
  });
});

describe('diagramPageToSvg', () => {
  it('fits the page into the box it is given without stretching it', () => {
    const svg = diagramPageToSvg(page({ shapes: [shape()] }), { width: 300, height: 200 });
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('viewBox="-10 0 140 90"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('paints a background only when asked for one', () => {
    expect(diagramPageToSvg(page({ shapes: [shape()] }), { width: 10, height: 10 }))
      .not.toContain('<rect');
    expect(diagramPageToSvg(page({ shapes: [shape()] }), { width: 10, height: 10, background: '#eeeeee' }))
      .toContain('fill="#eeeeee"');
  });

  it('escapes a label rather than letting it become markup', () => {
    const svg = diagramPageToSvg(page({ shapes: [shape({ label: 'a & b <c>' })] }), { width: 10, height: 10 });
    expect(svg).toContain('a &amp; b &lt;c&gt;');
    expect(svg).not.toContain('<c>');
  });

  it('arrows a connector at its target end', () => {
    const svg = diagramPageToSvg(page({
      shapes: [],
      connectors: [{
        id: 'c1', waypoints: [],
        startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 },
        style: { stroke: '#333333', strokeWidth: 2, opacity: 1, textColor: '#000000' },
      } as never],
    }), { width: 10, height: 10 });
    expect(svg).toContain('marker-end="url(#d-arrow)"');
    expect(svg).toContain('<marker id="d-arrow"');
  });
});
