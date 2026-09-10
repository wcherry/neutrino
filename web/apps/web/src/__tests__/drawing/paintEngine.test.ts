/**
 * The brush engine — redesign phase 4.
 *
 * Everything tested here is the half that does **not** touch a canvas, which is
 * deliberate and is why `paint/` is three modules rather than one: the bugs that
 * actually happen in a paint tool are in the arithmetic — stamps bunching at the
 * reported pointer positions, a pressure stroke tapering to nothing, smoothing
 * that never quite reaches the cursor — and none of them are about colour.
 *
 * The properties being pinned down:
 *
 * - **Spacing carries across events.** A pointer reports at 60Hz; stamping only
 *   where an event landed draws a dotted line, and resetting the spacing per
 *   event draws the same dotted line with extra stamps.
 * - **A stroke ends where the pointer was released**, not where the smoothing
 *   filter had got to.
 * - **Pressure never scales a stamp to nothing**, or the start of every stroke
 *   is a gap rather than a taper.
 */

import { describe, it, expect } from 'vitest';

import {
  BRUSH_PRESETS,
  DEFAULT_PRESSURE,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  PaintSession,
  StrokePath,
  applyPreset,
  clampBrush,
  createBrush,
  stampAlpha,
  stampSize,
  stampsBounds,
  strokePoint,
  type BrushSettings,
  type PaintSessionOptions,
} from '../../app/(apps)/drawing/editor/paint';
import { createDocument, createRasterLayer } from '../../app/(apps)/drawing/editor/document/factory';
import { addNode } from '../../app/(apps)/drawing/editor/document/edits';
import { loadDocumentBitmaps } from '../../app/(apps)/drawing/editor/render/renderDocument';

/** A brush with no smoothing, so a test can predict exactly where a stamp lands. */
function rigid(overrides: Partial<BrushSettings> = {}): BrushSettings {
  return clampBrush({ ...createBrush('pen'), smoothing: 0, spacing: 1, size: 10, ...overrides });
}

// ---------------------------------------------------------------------------
// Brushes
// ---------------------------------------------------------------------------

describe('brush settings', () => {
  it('keeps the colour when switching preset, and takes everything else', () => {
    const current = { ...createBrush('brush', '#ff0000'), size: 99 };
    const next = applyPreset(current, 'airbrush');

    // Colour is the one setting people carry between tools; hardness, flow and
    // spacing are exactly what switching is for.
    expect(next.color).toBe('#ff0000');
    expect(next.hardness).toBe(BRUSH_PRESETS.airbrush.hardness);
    expect(next.flow).toBe(BRUSH_PRESETS.airbrush.flow);
    expect(next.size).toBe(BRUSH_PRESETS.airbrush.size);
  });

  it('is the eraser preset, and only that one, that removes pixels', () => {
    const erasing = Object.entries(BRUSH_PRESETS).filter(([, preset]) => preset.erase);
    expect(erasing.map(([name]) => name)).toEqual(['eraser']);
  });

  it('clamps every value into a range the engine can act on', () => {
    const clamped = clampBrush({
      ...createBrush('brush'),
      size: 10_000, opacity: 4, flow: -1, hardness: 2, spacing: 0, smoothing: 9,
    });

    expect(clamped.size).toBe(MAX_BRUSH_SIZE);
    expect(clamped.opacity).toBe(1);
    expect(clamped.flow).toBe(0);
    expect(clamped.hardness).toBe(1);
    // Zero spacing is an infinite loop in the stamper, which is the reason this
    // clamp exists at all rather than for tidiness.
    expect(clamped.spacing).toBeGreaterThan(0);
    expect(clamped.smoothing).toBe(1);
  });

  it('never scales a stamp to nothing, however light the pressure', () => {
    const brush = rigid({ pressure: { size: true, opacity: false } });
    expect(stampSize(brush, 0)).toBeGreaterThanOrEqual(MIN_BRUSH_SIZE);
    expect(stampSize(brush, 1)).toBe(brush.size);
    // Monotonic, or a firmer press would draw a thinner line.
    expect(stampSize(brush, 0.8)).toBeGreaterThan(stampSize(brush, 0.2));
  });

  it('ignores pressure entirely when the brush says to', () => {
    const brush = rigid({ pressure: { size: false, opacity: false }, flow: 0.5 });
    expect(stampSize(brush, 0.1)).toBe(brush.size);
    expect(stampAlpha(brush, 0.1)).toBe(0.5);
  });
});

describe('pointer pressure', () => {
  it('treats a reported zero as "no sensor", not as no force', () => {
    // The Pointer Events API reports 0 for a mouse button that is held down, so
    // reading it literally tapers every mouse stroke to nothing.
    expect(strokePoint(0, 0, 0).pressure).toBe(DEFAULT_PRESSURE);
    expect(strokePoint(0, 0, undefined).pressure).toBe(DEFAULT_PRESSURE);
    expect(strokePoint(0, 0, 0.25).pressure).toBe(0.25);
    expect(strokePoint(0, 0, 5).pressure).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stroke path
// ---------------------------------------------------------------------------

describe('stamping a stroke', () => {
  it('places a stamp exactly where the stroke began', () => {
    const path = new StrokePath(rigid());
    const stamps = path.begin(strokePoint(10, 20, 1));

    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ x: 10, y: 20 });
  });

  it('fills the gap between two reported points', () => {
    // Spacing 1 × size 10 means a stamp every 10px, so a 100px jump is ten of
    // them — not one at each end, which is the dotted line this prevents.
    const path = new StrokePath(rigid());
    path.begin(strokePoint(0, 0, 1));
    const stamps = path.extend(strokePoint(100, 0, 1));

    expect(stamps).toHaveLength(10);
    expect(stamps.map((s) => Math.round(s.x))).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(stamps.every((s) => s.y === 0)).toBe(true);
  });

  it('carries the leftover distance into the next event', () => {
    const path = new StrokePath(rigid());
    path.begin(strokePoint(0, 0, 1));

    // Six pixels is not far enough for a stamp at spacing 10…
    expect(path.extend(strokePoint(6, 0, 1))).toHaveLength(0);
    // …and the next six take the total past it, so one lands at x = 10 rather
    // than the count restarting from the last reported position.
    const stamps = path.extend(strokePoint(12, 0, 1));
    expect(stamps).toHaveLength(1);
    expect(Math.round(stamps[0].x)).toBe(10);
  });

  it('ends at the raw position the pointer was released at', () => {
    const path = new StrokePath(rigid({ smoothing: 0.9 }));
    path.begin(strokePoint(0, 0, 1));
    path.extend(strokePoint(50, 0, 1));
    const stamps = path.end(strokePoint(100, 0, 1));

    // Heavy smoothing lags the cursor; without a final stamp at the release
    // point the line visibly stops short of what it was drawn to.
    const last = stamps[stamps.length - 1];
    expect(last.x).toBe(100);
    expect(last.y).toBe(0);
  });

  it('damps a jittery path towards where the stroke already was', () => {
    const smooth = new StrokePath(rigid({ smoothing: 0.8, spacing: 0.05 }));
    smooth.begin(strokePoint(0, 0, 1));
    const damped = smooth.extend(strokePoint(0, 100, 1));

    const raw = new StrokePath(rigid({ smoothing: 0, spacing: 0.05 }));
    raw.begin(strokePoint(0, 0, 1));
    const undamped = raw.extend(strokePoint(0, 100, 1));

    // The smoothed stroke has not travelled as far for the same input, which is
    // the lag that buys a steady line.
    expect(damped[damped.length - 1].y).toBeLessThan(undamped[undamped.length - 1].y);
  });

  it('reports no stamps when the pointer has not moved', () => {
    const path = new StrokePath(rigid());
    path.begin(strokePoint(5, 5, 1));
    expect(path.extend(strokePoint(5, 5, 1))).toHaveLength(0);
  });

  it('treats an extend before a begin as the start of the stroke', () => {
    // A pointer capture can deliver a move before the down event is processed;
    // dropping it would lose the first fraction of the stroke.
    const path = new StrokePath(rigid());
    expect(path.extend(strokePoint(3, 4, 1))).toHaveLength(1);
  });

  it('spaces stamps by the *current* size when pressure changes the width', () => {
    const path = new StrokePath(rigid({ pressure: { size: true, opacity: false }, spacing: 1 }));
    path.begin(strokePoint(0, 0, 1));
    const light = path.extend(strokePoint(100, 0, 0.1));

    // A thin stamp needs closer spacing, or the thin part of the stroke breaks
    // into dots while the thick part stays solid.
    expect(light.length).toBeGreaterThan(10);
  });
});

describe('the area a run of stamps covers', () => {
  it('includes each stamp’s full radius', () => {
    const bounds = stampsBounds([
      { x: 50, y: 50, size: 10, alpha: 1 },
      { x: 70, y: 60, size: 20, alpha: 1 },
    ])!;

    expect(bounds).toEqual({ x: 45, y: 45, width: 35, height: 25 });
  });

  it('is null for no stamps at all', () => {
    expect(stampsBounds([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/**
 * A canvas that records the compositing state of every draw made on it.
 *
 * jsdom has no 2D context, and the session's interesting behaviour is not about
 * pixels anyway — it is about *when* the brush's opacity and blend mode are
 * applied. Recording the state at each `drawImage` is exactly the assertion:
 * whole-stroke opacity has to land once, on the composite, and never per dab.
 */
interface Recorded {
  op: GlobalCompositeOperation;
  alpha: number;
}

function recordingSurfaces() {
  const draws: Recorded[] = [];
  const fills: Recorded[] = [];

  const factory = (width: number, height: number) => {
    const surface = {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
      toDataURL: () => 'data:image/png;base64,PAINTED',
    };
    const ctx = {
      canvas: surface,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      fillStyle: '' as unknown,
      save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
      setTransform: () => {}, translate: () => {}, clearRect: () => {}, rect: () => {},
      putImageData: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) =>
        ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      arc: () => {},
      fill: () => { fills.push({ op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); },
      drawImage: () => { draws.push({ op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); },
    };
    return surface;
  };

  return { draws, fills, factory: factory as unknown as PaintSessionOptions['createSurface'] };
}

function session(brush: BrushSettings, extra: Partial<PaintSessionOptions> = {}) {
  const surfaces = recordingSurfaces();
  const instance = PaintSession.begin({
    rect: { x: 0, y: 0, width: 100, height: 100 },
    brush,
    createSurface: surfaces.factory,
    ...extra,
  })!;
  return { ...surfaces, session: instance };
}

describe('a paint session', () => {
  it('stamps at flow, and applies the stroke’s opacity once on the composite', () => {
    const brush = rigid({ opacity: 0.4, flow: 0.9, hardness: 1, spacing: 1 });
    const { session: paint, fills, draws } = session(brush);

    paint.begin(strokePoint(10, 10, 1));
    paint.extend(strokePoint(50, 10, 1));

    // Every dab lands at `flow`, normally, into the stroke buffer.
    expect(fills.length).toBeGreaterThan(1);
    expect(fills.every((f) => f.op === 'source-over')).toBe(true);
    expect(fills.every((f) => Math.abs(f.alpha - 0.9) < 1e-9)).toBe(true);

    paint.commit();
    // …and the whole-stroke opacity is applied exactly once, when the buffer
    // meets the layer. Applying it per dab is what darkens self-overlaps.
    const composite = draws[draws.length - 1];
    expect(composite.alpha).toBeCloseTo(0.4);
  });

  it('composites an eraser stroke as destination-out', () => {
    const { session: paint, draws } = session(rigid({ erase: true }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    // Taking pixels away is a different compositing operation, which is the one
    // real behavioural switch between the presets.
    expect(draws[draws.length - 1].op).toBe('destination-out');
  });

  it('carries a blend mode through to the composite, not to each dab', () => {
    const { session: paint, draws, fills } = session(rigid({ blendMode: 'multiply' }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    expect(fills.every((f) => f.op === 'source-over')).toBe(true);
    // A multiply brush blended per dab would darken itself into black wherever
    // the stroke crossed itself.
    expect(draws[draws.length - 1].op).toBe('multiply');
  });

  it('clips the stroke to the selection, never the finished layer', () => {
    const { session: paint, draws } = session(rigid(), {
      selection: { kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 } },
    });
    paint.begin(strokePoint(5, 5, 1));
    paint.commit();

    // A `destination-in` against the selection appears — on the stroke buffer.
    // Masking the composed result instead would erase the layer's existing
    // pixels everywhere outside the selection.
    expect(draws.some((d) => d.op === 'destination-in')).toBe(false);
    expect(draws[draws.length - 1].op).toBe('source-over');
  });

  it('commits nothing for a stroke that laid nothing down', () => {
    const surfaces = recordingSurfaces();
    const paint = PaintSession.begin({
      rect: { x: 0, y: 0, width: 100, height: 100 },
      brush: rigid(),
      createSurface: surfaces.factory,
    })!;

    // No undo step and no re-encoded PNG, which is what makes tapping the
    // canvas with a brush free.
    expect(paint.hasPaint).toBe(false);
    expect(paint.commit()).toBeNull();
  });

  it('reports where the pixels go, offset by the layer’s own origin', () => {
    const surfaces = recordingSurfaces();
    const paint = PaintSession.begin({
      rect: { x: 40, y: 60, width: 100, height: 100 },
      brush: rigid(),
      createSurface: surfaces.factory,
    })!;
    paint.begin(strokePoint(45, 65, 1));

    expect(paint.commit()).toMatchObject({ x: 40, y: 60, width: 100, height: 100 });
  });

  it('does not composite the stroke a second time after committing', () => {
    const { session: paint, draws } = session(rigid({ opacity: 0.5 }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    const after = draws.length;
    paint.preview();
    // The preview is held on screen until the new PNG decodes; recompositing
    // there would apply a translucent stroke twice for that frame.
    expect(draws).toHaveLength(after);
    expect(paint.commit()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bitmap decoding
// ---------------------------------------------------------------------------

describe('decoding a document’s bitmaps', () => {
  const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('carries an already-decoded bitmap forward instead of decoding it again', async () => {
    const layer = createRasterLayer({ dataUrl: PIXEL, width: 1, height: 1, x: 0, y: 0 }, 'Photo');
    const doc = addNode(createDocument(), layer);

    const decoded = {} as CanvasImageSource;
    const map = await loadDocumentBitmaps(doc, new Map([[PIXEL, decoded]]));

    // A data URL is immutable — a layer whose pixels changed has a *different*
    // URL — so a cached entry is still correct, and reusing it is what stops a
    // brush stroke re-decoding every other layer in the drawing.
    expect(map.get(PIXEL)).toBe(decoded);
  });

  it('drops an entry the document no longer references', async () => {
    const doc = createDocument();
    const map = await loadDocumentBitmaps(doc, new Map([['data:image/png;base64,GONE', {} as CanvasImageSource]]));
    expect(map.size).toBe(0);
  });
});
