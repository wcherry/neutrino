/**
 * The JSX half of the fill defs.
 *
 * `ShapeFillDefs` and `diagramSvg`'s `fillDefsMarkup` are two hand-written
 * renderers of the same descriptor — one for the live canvas, one for markup a
 * PDF takes — so the shapes they emit are pinned separately.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { ShapeFillDefs } from '@/app/(apps)/diagrams/editor/ShapeFillDefs';
import type { DiagramShape, ShapeFill } from '@/app/(apps)/diagrams/types';

function shape(id: string, fill?: ShapeFill): DiagramShape {
  return {
    id,
    type: 'rectangle',
    x: 10, y: 20, width: 100, height: 50,
    label: '',
    style: {
      fill: '#ffffff', fillStyle: fill, stroke: '#000000', strokeWidth: 1, opacity: 1,
      fontSize: 12, fontFamily: 'Inter', textColor: '#111111',
    },
  } as DiagramShape;
}

function renderDefs(shapes: DiagramShape[], images = new Map<string, string>()) {
  const { container } = render(
    <svg><defs><ShapeFillDefs shapes={shapes} images={images} /></defs></svg>,
  );
  return container.querySelector('defs')!;
}

describe('ShapeFillDefs', () => {
  it('emits nothing when every shape is a plain colour', () => {
    expect(renderDefs([shape('a')]).children).toHaveLength(0);
  });

  it('emits a linear gradient with its stops', () => {
    const defs = renderDefs([
      shape('a', { type: 'gradient', value: 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)' }),
    ]);
    const grad = defs.querySelector('linearGradient')!;
    expect(grad.getAttribute('id')).toBe('dgfill-a');
    expect([...grad.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')))
      .toEqual(['#ff0000', '#0000ff']);
  });

  it('emits a radial gradient centred on the shape', () => {
    const defs = renderDefs([
      shape('a', { type: 'gradient', value: 'radial-gradient(circle, #111111 0%, #222222 100%)' }),
    ]);
    expect(defs.querySelector('radialGradient')?.getAttribute('r')).toBe('50%');
  });

  it('emits an image pattern sized to the shape', () => {
    const defs = renderDefs(
      [shape('a', { type: 'image', value: 'neutrino-drive:f1' })],
      new Map([['neutrino-drive:f1', 'data:image/png;base64,AAA']]),
    );
    const pattern = defs.querySelector('pattern')!;
    expect(pattern.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    expect(pattern.getAttribute('x')).toBe('10');
    expect(pattern.getAttribute('width')).toBe('100');
    // The tile's own origin is (x, y), so the image inside it starts at zero.
    const image = pattern.querySelector('image')!;
    expect(image.getAttribute('x')).toBe('0');
    expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  });

  it('paints the style the caller resolves, not the shape’s stored one', () => {
    const defs = renderDefs([shape('a')]);
    expect(defs.children).toHaveLength(0);

    const { container } = render(
      <svg><defs>
        <ShapeFillDefs
          shapes={[shape('a')]}
          images={new Map()}
          styleOf={(s) => ({
            ...s.style,
            fillStyle: { type: 'gradient', value: 'linear-gradient(0deg, #111111, #222222)' },
          })}
        />
      </defs></svg>,
    );
    expect(container.querySelector('linearGradient')).not.toBeNull();
  });
});
