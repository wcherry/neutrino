/**
 * The brush engine — redesign phase 4.
 *
 * Three layers, deliberately separable: `brush` is the parameters, `stroke`
 * turns pointer events into stamps and is pure arithmetic, and `session` is the
 * only part that touches a canvas. Everything the interesting bugs live in —
 * spacing carry-over, pressure response, smoothing lag — is therefore testable
 * without a rendering context.
 *
 * `paper`, `spray` and `medium` are the material half — the tooth a stroke
 * lands on, the droplets paint leaves a nozzle as, and what the paint is made
 * of. They sit beside `brush` rather than inside `session` for the same reason
 * the split exists at all: each is arithmetic over numbers and colours, and
 * only the applying of it needs pixels.
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

export {
  GRAIN_TILE,
  PAPER_GRAINS,
  PAPER_LABELS,
  PAPER_TYPES,
  buildGrainTile,
  grainAt,
  grainFor,
  grainForSize,
} from './paper';
export type { PaperGrain, PaperType } from './paper';

export {
  MEDIUM_LABELS,
  MEDIUM_PROFILES,
  PAINT_MEDIUMS,
  dabColor,
  mediumFor,
  parseRgba,
  pickUpLoad,
  rgbaToCss,
} from './medium';
export type { MediumProfile, PaintMedium, Rgba } from './medium';

export { dropletHardness, randomSource, splatterDroplets } from './spray';
export type { Droplet } from './spray';

export { DEFAULT_PRESSURE, StrokePath, stampsBounds, strokePoint } from './stroke';
export type { Stamp, StrokePoint } from './stroke';

export { PaintSession } from './session';
export type { PaintSessionOptions } from './session';
