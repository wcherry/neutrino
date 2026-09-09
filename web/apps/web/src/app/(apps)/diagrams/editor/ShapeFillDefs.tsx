'use client';

import React, { useEffect, useState } from 'react';
import type { DiagramShape, ShapeStyle } from '../types';
import { resolveFillImages } from './utils/fillImages';
import { collectFillImages, fillDefFor } from './utils/shapeFill';

const NO_IMAGES: ReadonlyMap<string, string> = new Map();

/** Resolves every image fill on the page, keyed by the value stored on the shape. */
export function useFillImages(shapes: DiagramShape[]): ReadonlyMap<string, string> {
  const [images, setImages] = useState<ReadonlyMap<string, string>>(NO_IMAGES);
  // The set of values, as a stable key — resolving must not re-run because a
  // shape moved, only because the pictures on the page changed.
  const key = collectFillImages(shapes).join(' ');

  useEffect(() => {
    if (!key) {
      setImages((prev) => (prev.size === 0 ? prev : NO_IMAGES));
      return;
    }
    let cancelled = false;
    resolveFillImages(shapes).then((resolved) => { if (!cancelled) setImages(resolved); });
    return () => { cancelled = true; };
    // `shapes` is read only for the values `key` already summarises; depending on
    // it would replace the map on every drag frame while downloading nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return images;
}

export interface ShapeFillDefsProps {
  shapes: DiagramShape[];
  images: ReadonlyMap<string, string>;
  /** The style actually painted — the canvas passes its conditional-formatting resolver. */
  styleOf?: (shape: DiagramShape) => ShapeStyle;
}

/**
 * The `<defs>` entries the shapes on a page reference for their fills.
 *
 * Rendered inside the SVG root rather than inside the transformed document
 * group: a gradient is in objectBoundingBox units and a pattern is in the user
 * space of the element that references it, so neither depends on where the defs
 * themselves sit.
 */
export function ShapeFillDefs({ shapes, images, styleOf }: ShapeFillDefsProps) {
  const defs = shapes
    .map((shape) => fillDefFor(shape, styleOf ? styleOf(shape) : shape.style, images))
    .filter((d): d is NonNullable<typeof d> => d !== null);

  if (defs.length === 0) return null;

  return (
    <>
      {defs.map((def) => {
        if (def.kind === 'gradient') {
          const { gradient } = def;
          const stops = gradient.stops.map((stop, i) => (
            <stop key={i} offset={`${stop.position}%`} stopColor={stop.color} />
          ));
          return gradient.kind === 'radial' ? (
            <radialGradient key={def.id} id={def.id} cx="50%" cy="50%" r="50%">{stops}</radialGradient>
          ) : (
            <linearGradient
              key={def.id}
              id={def.id}
              x1={gradient.x1} y1={gradient.y1}
              x2={gradient.x2} y2={gradient.y2}
            >
              {stops}
            </linearGradient>
          );
        }

        return (
          <pattern
            key={def.id}
            id={def.id}
            patternUnits="userSpaceOnUse"
            x={def.x} y={def.y}
            width={def.width} height={def.height}
          >
            <image
              href={def.href}
              x={0} y={0}
              width={def.width} height={def.height}
              preserveAspectRatio={def.aspect}
            />
          </pattern>
        );
      })}
    </>
  );
}
