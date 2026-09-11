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
 *
 * The three material settings land in three different places here, and which
 * place is the whole of what each one means:
 *
 * - **splatter** replaces one dab with a scatter of droplets, so it happens per
 *   stamp, inside the stroke buffer;
 * - **the medium** decides a dab's colour (from what the bristles picked up),
 *   its alpha and its edge, and then how the finished stroke meets the layer;
 * - **paper** masks the *stroke*, once, anchored to the canvas rather than to
 *   the stroke — which is what makes two passes hit the same peaks instead of
 *   filling each other's pits.
 */

import { applySelectionMask } from '../document/selection';
import type { BlendMode, RasterSource, Rect, SelectionShape } from '../document/types';
import type { Surface, SurfaceFactory } from '../render/renderDocument';
import type { BrushSettings } from './brush';
import {
  dabColor,
  mediumFor,
  parseRgba,
  pickUpLoad,
  rgbaToCss,
  transparentRgbaCss,
  type MediumProfile,
  type Rgba,
} from './medium';
import {
  GRAIN_TILE,
  buildGrainTile,
  grainFor,
  grainForSize,
  hasGrain,
  withDepth,
  type PaperGrain,
} from './paper';
import { dropletHardness, randomSource, splatterDroplets } from './spray';
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
  /**
   * Seeds the splatter.
   *
   * Given for a test that needs to know where a droplet landed; omitted in the
   * app, where two spray strokes breaking up identically would be the tell that
   * the texture is fake.
   */
  seed?: number;
}

export class PaintSession {
  private readonly base: Surface;
  private readonly strokeSurface: Surface;
  private readonly previewSurface: Surface;
  private readonly path: StrokePath;
  private readonly options: PaintSessionOptions;
  private readonly brush: BrushSettings;
  private readonly medium: MediumProfile;
  private readonly grain: PaperGrain | null;
  private readonly paint: Rgba;
  private readonly random: () => number;
  private painted = false;
  private committed = false;

  /** Lazily made, and only when a grain or a selection has to mask the stroke. */
  private maskedSurface: Surface | null = null;
  /** `undefined` until the pattern has been attempted; `null` once it failed. */
  private grainPattern: CanvasPattern | null | undefined;
  /** The layer as it was when the stroke began — read once, sampled per dab. */
  private baseData: ImageData | null | undefined;
  /**
   * What the bristles are carrying.
   *
   * Starts as the brush's own colour at zero weight, which is a brush that has
   * been loaded and has touched nothing yet. Starting empty instead makes the
   * first dab take the layer's colour whole — a stroke that begins as whatever
   * it happens to start on, before it has had a chance to pick anything up.
   */
  private loaded: Rgba | null;

  private constructor(options: PaintSessionOptions, base: Surface, stroke: Surface, preview: Surface) {
    this.options = options;
    this.brush = options.brush;
    this.base = base;
    this.strokeSurface = stroke;
    this.previewSurface = preview;
    this.path = new StrokePath(options.brush);
    this.medium = mediumFor(options.brush.medium);
    this.paint = parseRgba(options.brush.color) ?? { r: 0, g: 0, b: 0, a: 1 };
    this.loaded = { ...this.paint, a: 0 };
    this.random = randomSource(options.seed ?? Math.floor(Math.random() * 0xffffffff));

    // A medium brings its own texture — watercolour granulates whatever it is
    // painted on — so the two are one grain at the deeper of the two depths
    // rather than two passes that would multiply into a much darker tooth.
    const paper = grainFor(options.brush.paper);
    const depth = Math.max(paper.depth, this.medium.granulation);
    // Scaled by the brush's width last: the tooth is a fixed size in canvas
    // pixels, so how much of it a stroke feels depends on how wide the stroke
    // is against it.
    const combined = grainForSize(withDepth(paper, depth), options.brush.size);
    this.grain = hasGrain(combined) ? combined : null;
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
    const color = this.stampColor(stamp);
    const hardness = clamp01(this.brush.hardness + this.medium.hardness);
    // The medium's own body: watercolour goes on as a glaze whatever the flow
    // slider says, gouache goes on flat.
    const alpha = clamp01(stamp.alpha * this.medium.flowScale);

    if (this.brush.splatter > 0) {
      const droplets = splatterDroplets({ ...stamp, alpha }, this.brush.splatter, this.random);
      const edge = dropletHardness(hardness, this.brush.splatter);
      for (const droplet of droplets) {
        this.drawDisc(ctx, droplet.x, droplet.y, droplet.radius, droplet.alpha, edge, color);
      }
      return;
    }

    this.drawDisc(ctx, stamp.x, stamp.y, Math.max(0.5, stamp.size / 2), alpha, hardness, color);
  }

  /** One filled disc — the dab itself, or one droplet of a splattered one. */
  private drawDisc(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    hardness: number,
    color: string,
  ): void {
    ctx.globalAlpha = clamp01(alpha);
    if (hardness >= 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // A radial gradient is the falloff: opaque out to `hardness` of the radius,
    // then down to nothing at the edge. `createRadialGradient` needs a non-zero
    // inner radius to behave when hardness is 0, hence the small floor.
    const inner = Math.max(0.001, radius * hardness);
    const gradient = ctx.createRadialGradient(x, y, inner, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, transparentRgbaCss(color));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * The colour one dab lays down, after the bristles have had their say.
   *
   * The load advances on every dab of a picking-up medium, including the ones
   * over bare canvas — a brush unloads as it runs out of anything to lift, and
   * skipping those would leave it carrying the first colour it ever touched for
   * the rest of the stroke.
   */
  private stampColor(stamp: Stamp): string {
    // A mask is a luminance channel, so a stroke on one is white (reveal) or,
    // with the eraser, painted away. Mixing has no meaning in a channel, and an
    // eraser carries no paint to mix.
    if (this.options.mask) return '#ffffff';
    if (this.brush.erase || this.medium.pickUp <= 0) return this.brush.color;

    const sampled = this.sampleBase(stamp.x, stamp.y) ?? { ...this.paint, a: 0 };
    this.loaded = pickUpLoad(this.loaded, sampled, this.medium.loadRate);
    return rgbaToCss(dabColor(this.paint, this.loaded, this.medium.pickUp));
  }

  /**
   * One pixel of the layer as it was when the stroke began.
   *
   * Read back whole, once, on the first dab that needs it: `getImageData` is
   * synchronous and a call per dab is the one thing that makes a brush stutter,
   * while one call per stroke is a cost paid where a gesture already pauses. It
   * can fail — no context, a tainted canvas, no `getImageData` at all in a test
   * surface — and a medium that cannot sample simply paints its own colour.
   */
  private sampleBase(x: number, y: number): Rgba | null {
    if (this.baseData === undefined) this.baseData = this.readBase();
    const data = this.baseData;
    if (!data) return null;

    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= data.width || py >= data.height) return null;

    const i = (py * data.width + px) * 4;
    return { r: data.data[i], g: data.data[i + 1], b: data.data[i + 2], a: data.data[i + 3] / 255 };
  }

  private readBase(): ImageData | null {
    const ctx = this.base.getContext('2d');
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    try {
      return ctx.getImageData(0, 0, this.base.width, this.base.height);
    } catch {
      return null;
    }
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

  /** The stroke buffer laid onto a target context, masks and blend applied. */
  private compositeStroke(target: CanvasRenderingContext2D): void {
    target.save();
    target.globalAlpha = clamp01(this.brush.opacity * this.medium.opacityScale);
    target.globalCompositeOperation = this.brush.erase
      ? 'destination-out'
      // The medium overrides the brush's blend mode where it has an opinion —
      // a watercolour glaze is a multiply whatever the Blend control says,
      // because that is what makes it a glaze rather than opaque paint.
      : compositeFor(this.medium.blend ?? this.brush.blendMode);
    target.drawImage(this.maskedStroke() as CanvasImageSource, 0, 0);
    target.restore();
  }

  /**
   * The stroke with the paper's tooth and the selection taken out of its alpha.
   *
   * **On a copy, never on the stroke buffer itself.** Both masks are
   * `destination-in`, which multiplies alpha, and `compositeStroke` runs on
   * every preview frame as well as on the commit — applied in place, a partial
   * mask would multiply itself once per frame and the stroke would visibly
   * dissolve at the selection's edge over the course of a long drag.
   *
   * The copy is skipped entirely when there is nothing to mask, which is the
   * common case and the one that has to stay free.
   */
  private maskedStroke(): Surface {
    if (!this.grain && !this.options.selection) return this.strokeSurface;

    const width = this.strokeSurface.width;
    const height = this.strokeSurface.height;
    if (!this.maskedSurface) this.maskedSurface = this.options.createSurface(width, height);
    const ctx = this.maskedSurface.getContext('2d');
    if (!ctx) return this.strokeSurface;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.strokeSurface as CanvasImageSource, 0, 0);

    this.applyGrain(ctx, width, height);
    // Clipping happens on the *stroke*, not on the result: masking the composed
    // picture would erase the layer's existing pixels everywhere outside the
    // selection, which is the opposite of what a selection protects.
    if (this.options.selection) {
      applySelectionMask(this.maskedSurface, this.options.selection, {
        createSurface: this.options.createSurface,
        bitmaps: this.options.bitmaps,
        origin: { x: this.options.rect.x, y: this.options.rect.y },
      });
    }
    return this.maskedSurface;
  }

  /**
   * The paper's tooth multiplied into the stroke's alpha.
   *
   * The pattern is phased by the layer's own origin, so the grain is fixed to
   * the canvas rather than to the stroke: paint over the same spot twice and
   * the second pass finds the same peaks the first one did, which is the whole
   * of why this reads as paper instead of as noise. The fill is oversized by
   * one tile because `destination-in` erases whatever it does not cover, and
   * the phase offset pulls the origin off the top-left corner.
   */
  private applyGrain(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.grain) return;
    const pattern = this.paperPattern(ctx);
    if (!pattern) return;

    const offsetX = -mod(this.options.rect.x, GRAIN_TILE);
    const offsetY = -mod(this.options.rect.y, GRAIN_TILE);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.translate(offsetX, offsetY);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width - offsetX + GRAIN_TILE, height - offsetY + GRAIN_TILE);
    ctx.restore();
  }

  /**
   * The grain as a repeating pattern, built once per session.
   *
   * Null when the surfaces cannot make one — a test double, or a context
   * without `createImageData` — in which case the stroke is simply not
   * textured. A brush that paints untextured is a far better failure than one
   * that throws mid-gesture.
   */
  private paperPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.grainPattern !== undefined) return this.grainPattern;
    this.grainPattern = this.buildPaperPattern(ctx);
    return this.grainPattern;
  }

  private buildPaperPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (!this.grain || typeof ctx.createPattern !== 'function') return null;

    const tile = this.options.createSurface(GRAIN_TILE, GRAIN_TILE);
    const tileCtx = tile.getContext('2d');
    if (!tileCtx
      || typeof tileCtx.createImageData !== 'function'
      || typeof tileCtx.putImageData !== 'function') return null;

    const image = tileCtx.createImageData(GRAIN_TILE, GRAIN_TILE);
    image.data.set(buildGrainTile(this.grain));
    tileCtx.putImageData(image, 0, 0);
    return ctx.createPattern(tile as CanvasImageSource, 'repeat');
  }
}

/** A positive remainder, which `%` is not for a layer at a negative offset. */
function mod(value: number, period: number): number {
  return ((Math.round(value) % period) + period) % period;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function compositeFor(mode: BlendMode): GlobalCompositeOperation {
  return mode === 'normal' ? 'source-over' : (mode as GlobalCompositeOperation);
}

function surfaceToDataUrl(surface: Surface): string | null {
  const canvas = surface as HTMLCanvasElement;
  return typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : null;
}
