/**
 * Brushes.
 *
 * **A brush is a tool, not document content** (redesign §3). Nothing here is
 * saved into a drawing: what a stroke leaves behind is pixels in a raster
 * layer, and the settings that produced them live in the editor and, for the
 * user's own convenience, in `localStorage`. Storing the stroke as an editable
 * object instead would make every drawing depend on this build's brush
 * behaviour reproducing exactly, forever, which is a promise no paint program
 * has ever kept.
 *
 * The five presets are not five engines. They are five points in the same
 * parameter space — size, hardness, flow, spacing, pressure response — and the
 * one behavioural switch between them is `erase`, because taking pixels away is
 * a different compositing operation rather than a different-looking mark.
 *
 * Three of the dimensions describe the *material* rather than the mark, and
 * they are what stops a stroke reading as a shape filled with a colour:
 * `splatter` (paint leaving a nozzle as droplets), `paper` (the tooth it lands
 * on) and `medium` (what the paint is, and so how it mixes with what is under
 * it). Each is a dimension every brush has, so the engine never branches on the
 * brush *type*; the inspector shows each one where it means something, which is
 * a question about the panel rather than about the engine.
 */

import type { BlendMode } from '../document/types';
import { PAINT_MEDIUMS, type PaintMedium } from './medium';
import { PAPER_TYPES, type PaperType } from './paper';

export type BrushType = 'pen' | 'pencil' | 'brush' | 'airbrush' | 'marker' | 'eraser';

export interface PressureResponse {
  /** Pressure scales the stamp's diameter. */
  size: boolean;
  /** Pressure scales the stamp's alpha. */
  opacity: boolean;
}

export interface BrushSettings {
  type: BrushType;
  /** Stamp diameter in canvas pixels, at full pressure. */
  size: number;
  /** The whole stroke's alpha, applied once when the stroke is composited. */
  opacity: number;
  /**
   * One stamp's alpha.
   *
   * Separate from `opacity` and not a duplicate of it: flow accumulates where
   * a stroke crosses itself, opacity does not. That is the difference between
   * a marker (low flow, so overlaps darken) and a highlighter-like flat pass
   * (full flow at low opacity, so they do not).
   */
  flow: number;
  /** 0 is a soft airbrush edge, 1 a hard one. */
  hardness: number;
  /** Distance between stamps as a fraction of `size`. */
  spacing: number;
  color: string;
  blendMode: BlendMode;
  pressure: PressureResponse;
  /**
   * How much the pointer path is damped, 0–1.
   *
   * A mouse reports a jagged path and a trackpad a worse one; without damping
   * every stroke has the shake of the hand that drew it. High values lag the
   * cursor, which is why this is a setting rather than a constant.
   */
  smoothing: number;
  /** Whether the stroke removes pixels instead of adding them. */
  erase: boolean;
  /**
   * How far the dab breaks into droplets, 0–1.
   *
   * 0 is one soft disc — the airbrush this engine shipped with — and turning it
   * up widens the cone, breaks it into finer droplets and adds overspray, which
   * together are the difference between an airbrush and a spray can.
   */
  splatter: number;
  /**
   * The tooth the stroke is laid onto.
   *
   * On the brush rather than on the document because it describes how *this*
   * tool meets the surface: a pencil finds the tooth of a sheet that a marker
   * floods straight over, and a drawing-wide setting could not say that.
   */
  paper: PaperType;
  /** What the paint is, and therefore how it mixes with what is already there. */
  medium: PaintMedium;
}

export const BRUSH_PRESETS: Record<BrushType, Omit<BrushSettings, 'color'>> = {
  // A technical pen: uniform width, hard edge, no pressure at all. This is the
  // one people reach for to write with.
  pen: {
    type: 'pen', size: 4, opacity: 1, flow: 1, hardness: 1, spacing: 0.08,
    blendMode: 'normal', pressure: { size: false, opacity: false }, smoothing: 0.5, erase: false,
    splatter: 0, paper: 'smooth', medium: 'ink',
  },
  // Pressure on width only, edge nearly hard — a pencil's line varies in weight
  // rather than in darkness. It is the one preset that starts on a textured
  // sheet, because a pencil that does not find the tooth reads as a thin pen.
  pencil: {
    type: 'pencil', size: 3, opacity: 0.9, flow: 0.9, hardness: 0.9, spacing: 0.05,
    blendMode: 'normal', pressure: { size: true, opacity: false }, smoothing: 0.35, erase: false,
    splatter: 0, paper: 'cold-press', medium: 'ink',
  },
  brush: {
    type: 'brush', size: 24, opacity: 1, flow: 0.85, hardness: 0.55, spacing: 0.05,
    blendMode: 'normal', pressure: { size: true, opacity: true }, smoothing: 0.55, erase: false,
    splatter: 0, paper: 'smooth', medium: 'acrylic',
  },
  // Low flow and tight spacing: the mark builds up where the pointer dwells,
  // which is the whole behaviour of a spray. The spacing is wider than a pure
  // airbrush's would be because each dab is now a dozen droplets rather than
  // one disc, and a dozen arcs every fifth of a pixel is a stutter.
  airbrush: {
    type: 'airbrush', size: 48, opacity: 1, flow: 0.09, hardness: 0, spacing: 0.05,
    blendMode: 'normal', pressure: { size: false, opacity: true }, smoothing: 0.6, erase: false,
    splatter: 0.4, paper: 'smooth', medium: 'ink',
  },
  // Multiply and full flow at reduced opacity: strokes tint what is under them
  // and a stroke crossing itself does not turn into a solid block.
  marker: {
    type: 'marker', size: 20, opacity: 0.45, flow: 1, hardness: 0.85, spacing: 0.04,
    blendMode: 'multiply', pressure: { size: false, opacity: false }, smoothing: 0.4, erase: false,
    splatter: 0, paper: 'smooth', medium: 'ink',
  },
  eraser: {
    type: 'eraser', size: 32, opacity: 1, flow: 1, hardness: 0.8, spacing: 0.05,
    blendMode: 'normal', pressure: { size: true, opacity: false }, smoothing: 0.45, erase: true,
    splatter: 0, paper: 'smooth', medium: 'ink',
  },
};

export const BRUSH_LABELS: Record<BrushType, string> = {
  pen: 'Pen',
  pencil: 'Pencil',
  brush: 'Brush',
  airbrush: 'Airbrush',
  marker: 'Marker',
  eraser: 'Eraser',
};

export const DEFAULT_BRUSH_COLOR = '#111827';

export function createBrush(type: BrushType, color = DEFAULT_BRUSH_COLOR): BrushSettings {
  return { ...BRUSH_PRESETS[type], color };
}

/**
 * A brush with a preset's shape but the caller's own colour and size kept.
 *
 * Switching tools should not silently change what colour you are painting in —
 * that is the one setting people carry between brushes — while everything a
 * preset exists to describe (hardness, flow, spacing, pressure) is exactly what
 * switching is *for*.
 */
export function applyPreset(current: BrushSettings, type: BrushType): BrushSettings {
  const preset = BRUSH_PRESETS[type];
  return { ...preset, color: current.color };
}

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 512;

export function clampBrush(brush: BrushSettings): BrushSettings {
  return {
    ...brush,
    size: Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, brush.size)),
    opacity: clamp01(brush.opacity),
    flow: clamp01(brush.flow),
    hardness: clamp01(brush.hardness),
    // A spacing of zero is an infinite loop in the stamper, and anything below
    // a hundredth of the brush size is thousands of stamps for a mark nobody
    // can tell from the same stroke at 0.01.
    spacing: Math.min(2, Math.max(0.01, brush.spacing)),
    smoothing: clamp01(brush.smoothing),
    splatter: clamp01(brush.splatter),
    // A brush is restored from `localStorage`, so these two arrive as whatever
    // JSON was last written there — including a paper or a medium from a build
    // that named them differently. An unknown value falls back to the inert
    // member rather than reaching the engine, where it would index to
    // `undefined` and take the grain or the mixing with it.
    paper: PAPER_TYPES.includes(brush.paper) ? brush.paper : 'smooth',
    medium: PAINT_MEDIUMS.includes(brush.medium) ? brush.medium : 'ink',
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The diameter a stamp gets at a given pressure. */
export function stampSize(brush: BrushSettings, pressure: number): number {
  if (!brush.pressure.size) return brush.size;
  // Never all the way to zero: a stamp of diameter 0 draws nothing, so the
  // start of every pressure stroke would be a gap rather than a taper.
  return Math.max(MIN_BRUSH_SIZE, brush.size * (0.15 + 0.85 * clamp01(pressure)));
}

/** The alpha a stamp gets at a given pressure. */
export function stampAlpha(brush: BrushSettings, pressure: number): number {
  return brush.pressure.opacity ? brush.flow * clamp01(pressure) : brush.flow;
}
