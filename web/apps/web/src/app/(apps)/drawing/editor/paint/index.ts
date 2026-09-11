/**
 * The brush engine — redesign phase 4.
 *
 * Three layers, deliberately separable: `brush` is the parameters, `stroke`
 * turns pointer events into stamps and is pure arithmetic, and `session` is the
 * only part that touches a canvas. Everything the interesting bugs live in —
 * spacing carry-over, pressure response, smoothing lag — is therefore testable
 * without a rendering context.
 */

export {
  BRUSH_LABELS,
  BRUSH_PRESETS,
  DEFAULT_BRUSH_COLOR,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  applyPreset,
  clampBrush,
  createBrush,
  stampAlpha,
  stampSize,
} from './brush';
export type { BrushSettings, BrushType, PressureResponse } from './brush';

export { DEFAULT_PRESSURE, StrokePath, stampsBounds, strokePoint } from './stroke';
export type { Stamp, StrokePoint } from './stroke';

export { PaintSession } from './session';
export type { PaintSessionOptions } from './session';
