/**
 * Parsing SVG's `transform` attribute.
 *
 * SVG's transform list and the model's `Transform2D` are the same six numbers
 * in the same order — `matrix(a b c d e f)` *is* the storage format — so every
 * function here reduces a list of named operations to one matrix. The list
 * applies left to right with each further transform composed on the *inside*,
 * which is why the fold multiplies the accumulator by the next rather than the
 * other way round.
 *
 * Unrecognised functions are skipped rather than failing the attribute. The
 * transform list is a place where a stray unit (`translate(10px)`) turns up
 * often enough to matter, and skipping one operation leaves an object slightly
 * misplaced while refusing the attribute leaves it at the origin.
 */

import { IDENTITY, type Transform2D } from '../../document/types';
import { multiplyTransform } from '../../document/geometry';

const OPERATION = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

function args(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function operationMatrix(name: string, values: number[]): Transform2D | null {
  switch (name.toLowerCase()) {
    case 'matrix':
      if (values.length < 6) return null;
      return { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };

    case 'translate':
      if (values.length < 1) return null;
      // A one-argument translate moves along x only, per the specification.
      return { ...IDENTITY, e: values[0], f: values[1] ?? 0 };

    case 'scale':
      if (values.length < 1) return null;
      // A one-argument scale is uniform.
      return { ...IDENTITY, a: values[0], d: values[1] ?? values[0] };

    case 'rotate': {
      if (values.length < 1) return null;
      const cos = Math.cos(radians(values[0]));
      const sin = Math.sin(radians(values[0]));
      const rotation: Transform2D = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (values.length < 3) return rotation;
      // `rotate(angle cx cy)` is a rotation about a point, which is a translate
      // out, the rotation, and a translate back.
      const cx = values[1];
      const cy = values[2];
      return multiplyTransform(
        multiplyTransform({ ...IDENTITY, e: cx, f: cy }, rotation),
        { ...IDENTITY, e: -cx, f: -cy },
      );
    }

    case 'skewx':
      if (values.length < 1) return null;
      return { ...IDENTITY, c: Math.tan(radians(values[0])) };

    case 'skewy':
      if (values.length < 1) return null;
      return { ...IDENTITY, b: Math.tan(radians(values[0])) };

    default:
      return null;
  }
}

/** A `transform` attribute as one matrix. The identity for an absent or empty one. */
export function parseTransform(attribute: string | null | undefined): Transform2D {
  if (!attribute) return { ...IDENTITY };

  let result: Transform2D = { ...IDENTITY };
  OPERATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPERATION.exec(attribute)) !== null) {
    const operation = operationMatrix(match[1], args(match[2]));
    if (operation) result = multiplyTransform(result, operation);
  }
  return result;
}

/** Whether a matrix is a pure translation — the case geometry can absorb exactly. */
export function isTranslationOnly(t: Transform2D): boolean {
  return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1;
}

/**
 * Whether a matrix scales and translates but neither rotates nor shears.
 *
 * This is the other case a shape's own geometry can absorb without loss: a
 * rectangle scaled on both axes is still a rectangle, so it can keep its
 * editable `frame` instead of being frozen into a matrix on a layer of its own.
 */
export function isAxisAligned(t: Transform2D): boolean {
  return t.b === 0 && t.c === 0;
}
