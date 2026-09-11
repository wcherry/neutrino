/**
 * One stroke, from pointer-down to committed pixels.
 *
 * The shape of this is decided by one requirement: **a stroke's opacity applies
 * to the stroke, not to each dab of it.** Paint the stamps straight onto the
 * layer at 40% and every place the stroke crosses itself comes out darker than
 * 40%; paint them into a buffer of their own and composite that buffer once, and
 * it does not. So a session owns two surfaces —
 *
 * - **base**: the layer's existing pixels, untouched for the stroke's duration,
 *   which is what makes cancelling free and what an eraser needs something to
 *   erase from;
 * - **stroke**: the dabs, accumulating at `flow`.
 *
 * — and `preview` composites the two on demand for the screen. The layer in the
 * document is not written to at all until `commit`, which is also why a stroke
 * costs exactly one undo step rather than one per pointer event.
 *
 * The same machinery paints a **mask**: a mask channel is a raster source like
 * any other, and the only differences are that the colour is forced to
 * greyscale and that the result goes back to `node.mask.source`. That is the
 * whole of "painting on a mask", and duplicating the engine to say it would be
 * two implementations of stamp spacing to keep in step.
 */

import { applySelectionMask } from '../document/selection';
import type { BlendMode, RasterSource, Rect, SelectionShape } from '../document/types';
import type { Surface, SurfaceFactory } from '../render/renderDocument';
import type { BrushSettings } from './brush';
import { StrokePath, type Stamp, type StrokePoint } from './stroke';

export interface PaintSessionOptions {
  /** The layer's current pixels, already decoded. Absent for an empty layer. */
  bitmap?: CanvasImageSource | null;
  /** Where the target's pixels sit on the canvas, and how large they are. */
  rect: Rect;
  brush: BrushSettings;
  createSurface: SurfaceFactory;
  /** Confines the stroke, if anything is selected. */
  selection?: SelectionShape;
  /** Decoded bitmaps, so a `mask`-kind selection can be applied. */
  bitmaps?: ReadonlyMap<string, CanvasImageSource>;
  /**
   * Painting a mask channel rather than colour.
   *
   * The channel is greyscale, so the brush paints white to reveal and black to
   * hide whatever its colour is — a mask painted in red would read as its own
   * luminance, which is not what anyone picking red intends.
   */
  mask?: boolean;
}

export class PaintSession {
  private readonly base: Surface;
  private readonly strokeSurface: Surface;
  private readonly previewSurface: Surface;
  private readonly path: StrokePath;
  private readonly options: PaintSessionOptions;
  private readonly brush: BrushSettings;
  private painted = false;
  private committed = false;

  private constructor(options: PaintSessionOptions, base: Surface, stroke: Surface, preview: Surface) {
    this.options = options;
    this.brush = options.brush;
    this.base = base;
    this.strokeSurface = stroke;
    this.previewSurface = preview;
    this.path = new StrokePath(options.brush);
  }

  /**
   * Prepares the surfaces, or null when none can be made.
   *
   * Null rather than a throw: `getContext('2d')` returns null under memory
   * pressure and in jsdom, and a brush that quietly does nothing is a better
   * outcome than an editor that crashes mid-gesture.
   */
  static begin(options: PaintSessionOptions): PaintSession | null {
    const width = Math.max(1, Math.round(options.rect.width));
    const height = Math.max(1, Math.round(options.rect.height));

    const base = options.createSurface(width, height);
    const stroke = options.createSurface(width, height);
    const preview = options.createSurface(width, height);
    const baseCtx = base.getContext('2d');
    if (!baseCtx || !stroke.getContext('2d') || !preview.getContext('2d')) return null;

    if (options.bitmap) baseCtx.drawImage(options.bitmap, 0, 0, width, height);
    return new PaintSession(options, base, stroke, preview);
  }

  /** Canvas coordinates → the surfaces' own pixel coordinates. */
  private local(point: StrokePoint): StrokePoint {
    return {
      x: point.x - this.options.rect.x,
      y: point.y - this.options.rect.y,
      pressure: point.pressure,
    };
  }

  begin(point: StrokePoint): void {
    this.draw(this.path.begin(this.local(point)));
  }

  extend(point: StrokePoint): void {
    this.draw(this.path.extend(this.local(point)));
  }

  end(point: StrokePoint): void {
    this.draw(this.path.end(this.local(point)));
  }

  /** Whether any pixel was actually laid down — what decides if there is an edit to keep. */
  get hasPaint(): boolean {
    return this.painted;
  }

  private draw(stamps: readonly Stamp[]): void {
    if (stamps.length === 0) return;
    const ctx = this.strokeSurface.getContext('2d');
    if (!ctx) return;

    ctx.save();
    // Stamps always accumulate normally *within* the stroke buffer. The brush's
    // own blend mode describes how the finished stroke meets the layer, and
    // applying it per dab would blend each dab against the ones before it —
    // a multiply brush would darken itself into black wherever it overlapped.
    ctx.globalCompositeOperation = 'source-over';
    for (const stamp of stamps) this.drawStamp(ctx, stamp);
    ctx.restore();
    this.painted = true;
  }

  private drawStamp(ctx: CanvasRenderingContext2D, stamp: Stamp): void {
    const radius = Math.max(0.5, stamp.size / 2);
    // A mask is a luminance channel, so a stroke on one is white (reveal) or,
    // with the eraser, painted away.
    const color = this.options.mask ? '#ffffff' : this.brush.color;

    ctx.globalAlpha = Math.max(0, Math.min(1, stamp.alpha));
    if (this.brush.hardness >= 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(stamp.x, stamp.y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // A radial gradient is the falloff: opaque out to `hardness` of the radius,
    // then down to nothing at the edge. `createRadialGradient` needs a non-zero
    // inner radius to behave when hardness is 0, hence the small floor.
    const inner = Math.max(0.001, radius * this.brush.hardness);
    const gradient = ctx.createRadialGradient(stamp.x, stamp.y, inner, stamp.x, stamp.y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, transparentVersionOf(color));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(stamp.x, stamp.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * The target's pixels as they would look if the stroke ended now.
   *
   * Recomposited from scratch each time rather than maintained incrementally.
   * That is two draws of one layer-sized surface per frame, which is what the
   * compositor does for any layer with a blend mode anyway — and the
   * incremental version would have to special-case the eraser, whose stroke
   * *removes* what an earlier frame drew.
   */
  preview(): Surface | null {
    // Once committed, the base *is* the answer: `commit` composited the stroke
    // into it. Compositing again would apply a translucent stroke twice, which
    // is exactly what the caller sees while it holds the preview on screen
    // waiting for the new PNG to decode.
    if (this.committed) return this.base;

    const ctx = this.previewSurface.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.previewSurface.width, this.previewSurface.height);
    ctx.drawImage(this.base as CanvasImageSource, 0, 0);
    this.compositeStroke(ctx);
    return this.previewSurface;
  }

  /**
   * The finished pixels, ready to go back into the document.
   *
   * Returns null when the stroke laid nothing down, so a click that missed
   * leaves no undo step and no re-encoded PNG behind.
   */
  commit(): RasterSource | null {
    if (!this.painted || this.committed) return null;
    const ctx = this.base.getContext('2d');
    if (!ctx) return null;

    this.compositeStroke(ctx);
    this.committed = true;
    const dataUrl = surfaceToDataUrl(this.base);
    if (!dataUrl) return null;

    return {
      dataUrl,
      width: this.base.width,
      height: this.base.height,
      x: this.options.rect.x,
      y: this.options.rect.y,
    };
  }

  /** The stroke buffer laid onto a target context, selection and blend applied. */
  private compositeStroke(target: CanvasRenderingContext2D): void {
    // Clipping happens on the *stroke*, not on the result: masking the composed
    // picture would erase the layer's existing pixels everywhere outside the
    // selection, which is the opposite of what a selection protects.
    if (this.options.selection) {
      applySelectionMask(this.strokeSurface, this.options.selection, {
        createSurface: this.options.createSurface,
        bitmaps: this.options.bitmaps,
        origin: { x: this.options.rect.x, y: this.options.rect.y },
      });
    }

    target.save();
    target.globalAlpha = this.brush.opacity;
    target.globalCompositeOperation = this.brush.erase
      ? 'destination-out'
      : compositeFor(this.brush.blendMode);
    target.drawImage(this.strokeSurface as CanvasImageSource, 0, 0);
    target.restore();
  }
}

function compositeFor(mode: BlendMode): GlobalCompositeOperation {
  return mode === 'normal' ? 'source-over' : (mode as GlobalCompositeOperation);
}

/**
 * The same colour at zero alpha, for the outer stop of a stamp's falloff.
 *
 * `transparent` would work in a browser but resolves to transparent *black* in
 * some engines, which fringes a light stroke with a dark halo. Naming the
 * colour explicitly avoids relying on which behaviour is in play.
 */
function transparentVersionOf(color: string): string {
  const hex = color.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (match) {
    const digits = match[1].length === 3
      ? match[1].split('').map((c) => c + c).join('')
      : match[1];
    const r = parseInt(digits.slice(0, 2), 16);
    const g = parseInt(digits.slice(2, 4), 16);
    const b = parseInt(digits.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0)`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(hex);
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => p.trim());
    return `rgba(${parts[0]},${parts[1] ?? 0},${parts[2] ?? 0},0)`;
  }
  return 'rgba(0,0,0,0)';
}

function surfaceToDataUrl(surface: Surface): string | null {
  const canvas = surface as HTMLCanvasElement;
  return typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : null;
}
