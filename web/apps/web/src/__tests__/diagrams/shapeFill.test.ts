/**
 * Shape fills as SVG paint.
 *
 * The `FillPicker` speaks CSS and a diagram is drawn in SVG, so a gradient has
 * to become a `<linearGradient>` and an image a `<pattern>`. These pin down the
 * conversion, and the property the whole design rests on: `style.fill` stays a
 * plain colour beside `fillStyle`, so a surface that cannot paint a gradient —
 * the minimap, a Mermaid export — and a shape whose image has not loaded both
 * fall back to a colour rather than to nothing.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@neutrino/api-diagrams', () => ({ diagramsApi: { getDiagram: vi.fn() } }));

import {
  collectFillImages,
  fillDefFor,
  fillDefId,
  fillPaint,
  gradientVector,
  parseGradient,
  representativeColor,
  shapeFillOf,
} from '@/app/(apps)/diagrams/editor/utils/shapeFill';
import { diagramPageToSvg } from '@/app/(apps)/diagrams/editor/diagramSvg';
import type { DiagramPage, DiagramShape, ShapeFill } from '@/app/(apps)/diagrams/types';

function shape(over: Partial<DiagramShape> = {}, fill?: ShapeFill): DiagramShape {
  return {
    id: 'sh1',
    type: 'rectangle',
    x: 10, y: 20, width: 100, height: 50,
    label: '',
    style: {
      fill: '#ffffff', fillStyle: fill, stroke: '#000000', strokeWidth: 1, opacity: 1,
      fontSize: 12, fontFamily: 'Inter', textColor: '#111111',
    },
    ...over,
  } as DiagramShape;
}

function page(shapes: DiagramShape[]): DiagramPage {
  return { id: 'p1', name: 'Page 1', shapes, connectors: [] } as DiagramPage;
}

const GRADIENT = 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)';

describe('shapeFillOf', () => {
  it('reads a colour out of `fill` when the shape declares no fill style', () => {
    expect(shapeFillOf(shape().style)).toEqual({ type: 'color', value: '#ffffff' });
  });

  it('prefers the declared fill style', () => {
    const style = shape({}, { type: 'gradient', value: GRADIENT }).style;
    expect(shapeFillOf(style)).toEqual({ type: 'gradient', value: GRADIENT });
  });
});

describe('parseGradient', () => {
  it('reads the stops and the angle of a linear gradient', () => {
    expect(parseGradient(GRADIENT)).toMatchObject({
      kind: 'linear',
      stops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }],
    });
  });

  it('spreads stops that carry no position of their own', () => {
    expect(parseGradient('linear-gradient(45deg, #111111, #222222, #333333)')?.stops)
      .toEqual([
        { color: '#111111', position: 0 },
        { color: '#222222', position: 50 },
        { color: '#333333', position: 100 },
      ]);
  });

  it('understands a keyword direction as well as an angle', () => {
    expect(parseGradient('linear-gradient(to right, #111111 0%, #222222 100%)'))
      .toMatchObject(gradientVector(90));
  });

  it('skips the shape keyword of a radial gradient', () => {
    expect(parseGradient('radial-gradient(circle, #111111 0%, #222222 100%)')).toMatchObject({
      kind: 'radial',
      stops: [{ color: '#111111', position: 0 }, { color: '#222222', position: 100 }],
    });
  });

  it('is null for anything it does not model, so the caller keeps its colour', () => {
    expect(parseGradient('conic-gradient(#111111, #222222)')).toBeNull();
    expect(parseGradient('linear-gradient(90deg, #111111)')).toBeNull();
  });
});

describe('gradientVector', () => {
  it('puts 0deg bottom-to-top, as CSS does and SVG does not', () => {
    expect(gradientVector(0)).toEqual({ x1: 0.5, y1: 1, x2: 0.5, y2: 0 });
  });

  it('puts 90deg left-to-right', () => {
    const v = gradientVector(90);
    expect(v.x1).toBeCloseTo(0);
    expect(v.y1).toBeCloseTo(0.5);
    expect(v.x2).toBeCloseTo(1);
    expect(v.y2).toBeCloseTo(0.5);
  });
});

describe('representativeColor', () => {
  it('takes a gradient down to its first stop', () => {
    expect(representativeColor({ type: 'gradient', value: GRADIENT }, '#ffffff')).toBe('#ff0000');
  });

  it('keeps the previous colour behind an image, which has none of its own', () => {
    expect(representativeColor({ type: 'image', value: 'neutrino-drive:f1' }, '#abcdef'))
      .toBe('#abcdef');
  });

  it('keeps the previous colour when the gradient cannot be read', () => {
    expect(representativeColor({ type: 'gradient', value: 'conic-gradient(#111, #222)' }, '#abcdef'))
      .toBe('#abcdef');
  });
});

describe('fillDefFor', () => {
  it('is null for a plain colour, which needs no def', () => {
    const s = shape();
    expect(fillDefFor(s, s.style)).toBeNull();
  });

  it('describes a gradient def', () => {
    const s = shape({}, { type: 'gradient', value: GRADIENT });
    expect(fillDefFor(s, s.style)).toMatchObject({ kind: 'gradient', id: 'dgfill-sh1' });
  });

  it('sizes an image pattern to the shape it fills', () => {
    const s = shape({}, { type: 'image', value: 'neutrino-drive:f1', objectFit: 'contain' });
    expect(fillDefFor(s, s.style, new Map([['neutrino-drive:f1', 'data:image/png;base64,AAA']])))
      .toEqual({
        kind: 'pattern',
        id: 'dgfill-sh1',
        href: 'data:image/png;base64,AAA',
        aspect: 'xMidYMid meet',
        x: 10, y: 20, width: 100, height: 50,
      });
  });

  it('is null for an image that has not resolved, so the shape keeps its colour', () => {
    const s = shape({}, { type: 'image', value: 'neutrino-drive:f1' });
    expect(fillDefFor(s, s.style, new Map())).toBeNull();
    expect(fillPaint(s.id, s.style, false)).toBe('#ffffff');
  });

  it('reads the style it is handed, not the shape’s own — conditional formatting wins', () => {
    const s = shape();
    const overridden = { ...s.style, fillStyle: { type: 'gradient', value: GRADIENT } as ShapeFill };
    expect(fillDefFor(s, overridden)).toMatchObject({ kind: 'gradient' });
  });
});

describe('fillDefId', () => {
  it('makes an id a fragment reference can name', () => {
    expect(fillDefId('node:1/2')).toBe('dgfill-node_1_2');
  });
});

describe('collectFillImages', () => {
  it('lists each image once, and ignores colours and gradients', () => {
    expect(collectFillImages([
      shape({ id: 'a' }, { type: 'image', value: 'neutrino-drive:f1' }),
      shape({ id: 'b' }, { type: 'image', value: 'neutrino-drive:f1' }),
      shape({ id: 'c' }, { type: 'gradient', value: GRADIENT }),
      shape({ id: 'd' }),
    ])).toEqual(['neutrino-drive:f1']);
  });
});

describe('diagramPageToSvg with a non-colour fill', () => {
  it('emits the gradient and points the shape at it', () => {
    const svg = diagramPageToSvg(page([shape({}, { type: 'gradient', value: GRADIENT })]), {
      width: 100, height: 100,
    });
    expect(svg).toContain('<linearGradient id="dgfill-sh1"');
    expect(svg).toContain('<stop offset="0%" stop-color="#ff0000"/>');
    expect(svg).toContain('fill="url(#dgfill-sh1)"');
  });

  it('inlines an image fill as a pattern when the bytes are supplied', () => {
    const svg = diagramPageToSvg(page([shape({}, { type: 'image', value: 'neutrino-drive:f1' })]), {
      width: 100, height: 100,
      images: new Map([['neutrino-drive:f1', 'data:image/png;base64,AAA']]),
    });
    expect(svg).toContain('<pattern id="dgfill-sh1" patternUnits="userSpaceOnUse"');
    expect(svg).toContain('href="data:image/png;base64,AAA"');
    expect(svg).toContain('fill="url(#dgfill-sh1)"');
  });

  it('falls back to the colour when the image was not resolved', () => {
    const svg = diagramPageToSvg(page([shape({}, { type: 'image', value: 'neutrino-drive:f1' })]), {
      width: 100, height: 100,
    });
    expect(svg).not.toContain('<pattern');
    expect(svg).toContain('fill="#ffffff"');
  });
});
