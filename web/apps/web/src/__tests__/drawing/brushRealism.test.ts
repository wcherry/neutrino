/**
 * The material half of the brush engine — paper, spray and paint medium.
 *
 * These are the three settings that stop a stroke reading as a shape filled
 * with a colour, and each one has exactly one property that makes it work and
 * that a plausible-looking implementation gets wrong:
 *
 * - **Paper is fixed to the canvas, not to the stroke.** Grain that travels
 *   with the mark is noise; grain that stays put is tooth, because a second
 *   pass then finds the same peaks the first one did. Periodicity is the same
 *   requirement seen from the other end — a tile that does not meet itself
 *   leaves a seam every 128 pixels.
 * - **Splatter of zero is the old airbrush, exactly.** A setting you cannot
 *   turn off is a different tool, not a setting.
 * - **A medium mixes what the brush is carrying, not what is under the dab.**
 *   Sampling per dab gives a stroke that switches colour at every boundary it
 *   crosses; a loaded bristle carries the colour on and lets it go gradually,
 *   which is what oil actually does.
 */

import { describe, it, expect } from 'vitest';

import {
  BRUSH_PRESETS,
  GRAIN_TILE,
  MEDIUM_PROFILES,
  PAINT_MEDIUMS,
  PAPER_GRAINS,
  PaintSession,
  buildGrainTile,
  clampBrush,
  createBrush,
  dabColor,
  dropletHardness,
  grainAt,
  grainFor,
  grainForSize,
  parseRgba,
  pickUpLoad,
  randomSource,
  rgbaToCss,
  splatterDroplets,
  strokePoint,
  type BrushSettings,
  type PaintSessionOptions,
  type Rgba,
} from '../../app/(apps)/drawing/editor/paint';

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

describe('paper grain', () => {
  it('is perfectly flat for a smooth sheet', () => {
    // Not "nearly 1": the zero is what lets the session skip the tile, the
    // pattern and the whole extra compositing pass.
    expect(PAPER_GRAINS.smooth.depth).toBe(0);
    for (let x = 0; x < 40; x += 7) {
      expect(grainAt(x, x * 3, PAPER_GRAINS.smooth)).toBe(1);
    }
  });

  it('repeats exactly, so a tiled pattern has no seam', () => {
    const grain = PAPER_GRAINS['cold-press'];
    for (const [x, y] of [[0, 0], [13, 41], [67, 5], [127, 127]]) {
      expect(grainAt(x + GRAIN_TILE, y, grain)).toBeCloseTo(grainAt(x, y, grain), 10);
      expect(grainAt(x, y + GRAIN_TILE, grain)).toBeCloseTo(grainAt(x, y, grain), 10);
      expect(grainAt(x - GRAIN_TILE, y - GRAIN_TILE, grain))
        .toBeCloseTo(grainAt(x, y, grain), 10);
    }
  });

  it('never takes more than the paper’s depth away', () => {
    for (const grain of Object.values(PAPER_GRAINS)) {
      for (let x = 0; x < GRAIN_TILE; x += 3) {
        for (let y = 0; y < GRAIN_TILE; y += 11) {
          const value = grainAt(x, y, grain);
          expect(value).toBeLessThanOrEqual(1);
          expect(value).toBeGreaterThanOrEqual(1 - grain.depth);
        }
      }
    }
  });

  it('gives a rougher sheet a deeper tooth than a smoother one', () => {
    const spread = (paper: keyof typeof PAPER_GRAINS) => {
      const grain = PAPER_GRAINS[paper];
      let min = Infinity;
      let max = -Infinity;
      for (let x = 0; x < GRAIN_TILE; x++) {
        for (let y = 0; y < GRAIN_TILE; y += 5) {
          const value = grainAt(x, y, grain);
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      return max - min;
    };

    // Ordered, or the paper picker is a list of names for the same surface.
    expect(spread('vellum')).toBeLessThan(spread('cold-press'));
    expect(spread('cold-press')).toBeLessThan(spread('rough'));
  });

  it('cuts, rather than shading gently from peak to pit', () => {
    // This replaced a test asserting the opposite — that a rough sheet keeps
    // most of the stroke's weight — which was the wrong property to protect.
    // Preserving weight meant preserving a gradient, and a gradient is a wash
    // of light and dark rather than a surface: graphite reaches what it can
    // and misses the rest. So what matters is **contrast**, and the assertion
    // is that most of a rough sheet is decidedly one or the other.
    const values: number[] = [];
    for (let x = 0; x < GRAIN_TILE; x++) {
      for (let y = 0; y < GRAIN_TILE; y++) values.push(grainAt(x, y, PAPER_GRAINS.rough));
    }

    const committed = values.filter((v) => v > 0.85 || v < 0.15).length;
    expect(committed / values.length).toBeGreaterThan(0.5);
    // And it does reach both ends: a sheet that is all peak has no tooth, and
    // one that is all pit takes the stroke away rather than texturing it.
    expect(values.some((v) => v > 0.95)).toBe(true);
    expect(values.some((v) => v < 0.1)).toBe(true);
  });

  it('cuts harder the more bite a paper has', () => {
    const midTones = (paper: keyof typeof PAPER_GRAINS) => {
      let count = 0;
      for (let x = 0; x < GRAIN_TILE; x++) {
        for (let y = 0; y < GRAIN_TILE; y += 3) {
          const value = grainAt(x, y, PAPER_GRAINS[paper]);
          // Measured against each paper's own range, so this is about the shape
          // of the curve rather than about how deep the paper happens to be.
          const normalized = (value - (1 - PAPER_GRAINS[paper].depth)) / PAPER_GRAINS[paper].depth;
          if (normalized > 0.25 && normalized < 0.75) count++;
        }
      }
      return count;
    };

    // Canvas is the softest-cutting paper and rough the hardest, so rough
    // should have far less of the sheet sitting in between.
    expect(midTones('rough')).toBeLessThan(midTones('canvas'));
  });

  it('writes the grain into the alpha channel of a white tile', () => {
    const tile = buildGrainTile(PAPER_GRAINS.canvas);
    expect(tile).toHaveLength(GRAIN_TILE * GRAIN_TILE * 4);

    for (let i = 0; i < 40; i += 4) {
      // White, because the tile is used as a `destination-in` mask where only
      // alpha is read — and white is the one colour that cannot tint anything
      // if it is ever drawn normally by mistake.
      expect(tile[i]).toBe(255);
      expect(tile[i + 1]).toBe(255);
      expect(tile[i + 2]).toBe(255);
    }
    expect(tile[3]).toBe(Math.round(255 * grainAt(0, 0, PAPER_GRAINS.canvas)));
    expect(tile[(5 * GRAIN_TILE + 9) * 4 + 3])
      .toBe(Math.round(255 * grainAt(9, 5, PAPER_GRAINS.canvas)));
  });

  it('falls back to a flat surface for a paper it does not know', () => {
    expect(grainFor('brown-paper-bag' as never)).toBe(PAPER_GRAINS.smooth);
  });

  it('lets a fine point into the pits a broad one rides over', () => {
    const rough = PAPER_GRAINS.rough;
    const fine = grainForSize(rough, 3);
    const broad = grainForSize(rough, 64);

    // The tooth is a fixed size in canvas pixels, so how much of it a stroke
    // feels depends on how wide the stroke is against it. Without this a
    // three-pixel line on rough paper can sit inside one hollow and not be
    // drawn at all — the setting stops being a texture and becomes a chance of
    // having painted.
    expect(fine.depth).toBeLessThan(broad.depth);
    expect(broad.depth).toBe(rough.depth);
    // Never to nothing, or a fine pencil on rough paper is a fine pencil on a
    // plate.
    expect(fine.depth).toBeGreaterThan(0.2);
  });

  it('leaves a smooth sheet smooth at every brush size', () => {
    for (const size of [1, 3, 40, 512]) {
      expect(grainForSize(PAPER_GRAINS.smooth, size).depth).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Splatter
// ---------------------------------------------------------------------------

const DAB = { x: 100, y: 100, size: 40, alpha: 0.5 };

describe('spray splatter', () => {
  it('produces no droplets at all when it is turned off', () => {
    // Empty, not "one droplet in the middle": a splatter of zero has to be the
    // old airbrush pixel for pixel, or the setting cannot be turned off.
    expect(splatterDroplets(DAB, 0, randomSource(1))).toEqual([]);
    expect(splatterDroplets(DAB, -1, randomSource(1))).toEqual([]);
  });

  it('breaks into more and finer droplets as it is turned up', () => {
    const light = splatterDroplets(DAB, 0.2, randomSource(7));
    const heavy = splatterDroplets(DAB, 1, randomSource(7));

    expect(heavy.length).toBeGreaterThan(light.length);
    expect(mean(heavy.map((d) => d.radius))).toBeLessThan(mean(light.map((d) => d.radius)));
  });

  it('throws overspray past the edge of the dab', () => {
    const droplets = splatterDroplets(DAB, 1, randomSource(3));
    const radius = DAB.size / 2;
    const furthest = Math.max(...droplets.map((d) => Math.hypot(d.x - DAB.x, d.y - DAB.y)));

    // A stencilled edge reads as sprayed rather than cut because some paint
    // lands outside the cone — so at full splatter something has to.
    expect(furthest).toBeGreaterThan(radius);
    // But not arbitrarily far: the spread is bounded, or a stroke's dirty
    // rectangle stops covering what it painted.
    expect(furthest).toBeLessThanOrEqual(radius * 1.75 + 1e-9);
  });

  it('is denser at the middle of the cone than at its rim', () => {
    const radius = (DAB.size / 2) * 1.75;
    let inner = 0;
    let total = 0;
    // Over many dabs rather than one: a single dab of two dozen droplets is a
    // small enough sample that a seed can land either side of any threshold,
    // and what is being asserted is the distribution, not one draw from it.
    for (let seed = 1; seed <= 40; seed++) {
      for (const droplet of splatterDroplets(DAB, 1, randomSource(seed))) {
        total++;
        if (Math.hypot(droplet.x - DAB.x, droplet.y - DAB.y) < radius / 2) inner++;
      }
    }

    // Half the radius is a quarter of the area, so an even scatter would put
    // about a quarter of the droplets there. A cone puts more.
    expect(inner / total).toBeGreaterThan(0.3);
  });

  it('never makes a droplet darker than the dab it came from', () => {
    for (const droplet of splatterDroplets(DAB, 0.6, randomSource(5))) {
      expect(droplet.alpha).toBeLessThanOrEqual(DAB.alpha);
      expect(droplet.alpha).toBeGreaterThan(0);
      // Below a third of a pixel an arc antialiases away to nothing, which
      // would quietly turn the splatter slider into a second opacity control.
      expect(droplet.radius).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('gives a droplet a defined rim even for a brush with none', () => {
    // The airbrush sits at hardness 0. Drawing its droplets with that falloff
    // gives back the featureless cloud the splatter existed to break up.
    expect(dropletHardness(0, 0.4)).toBeGreaterThan(0.5);
    // …while a hard brush is not softened by turning splatter on.
    expect(dropletHardness(1, 0.4)).toBe(1);
  });

  it('replays a stroke exactly for a given seed, and differs without one', () => {
    const a = splatterDroplets(DAB, 0.5, randomSource(42));
    const b = splatterDroplets(DAB, 0.5, randomSource(42));
    const c = splatterDroplets(DAB, 0.5, randomSource(43));

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

// ---------------------------------------------------------------------------
// Paint media
// ---------------------------------------------------------------------------

const RED: Rgba = { r: 255, g: 0, b: 0, a: 1 };
const BLUE: Rgba = { r: 0, g: 0, b: 255, a: 1 };
const NOTHING: Rgba = { r: 0, g: 0, b: 0, a: 0 };

describe('paint media', () => {
  it('has one inert medium, for the tools that are not paint', () => {
    // A pen, a pencil and an eraser still have a medium — that is what keeps
    // the engine free of `if (brush.type === …)` — so one member has to mean
    // "no medium behaviour at all".
    expect(MEDIUM_PROFILES.ink).toMatchObject({
      pickUp: 0, blend: null, flowScale: 1, hardness: 0, granulation: 0,
    });
    for (const type of ['pen', 'pencil', 'marker', 'eraser'] as const) {
      expect(BRUSH_PRESETS[type].medium).toBe('ink');
    }
  });

  it('separates the opaque media from the glaze by how they blend', () => {
    // Watercolour is a multiply because that is what makes it a glaze; oil,
    // acrylic and gouache cover what is under them.
    expect(MEDIUM_PROFILES.watercolor.blend).toBe('multiply');
    for (const medium of ['oil', 'acrylic', 'gouache'] as const) {
      expect(MEDIUM_PROFILES[medium].blend).toBeNull();
      expect(MEDIUM_PROFILES[medium].opacityScale).toBe(1);
    }
  });

  it('thins a glaze in both places a stroke gets its alpha', () => {
    // Thinning the dabs alone is not enough: a densely spaced brush still
    // accumulates its buffer to nearly full alpha, and a glaze that arrives
    // opaque is not a glaze. Both, or watercolour multiplies at full strength
    // and goes black over anything saturated.
    expect(MEDIUM_PROFILES.watercolor.flowScale).toBeLessThan(1);
    expect(MEDIUM_PROFILES.watercolor.opacityScale).toBeLessThan(1);
  });

  it('orders the media by how much they lift', () => {
    // Oil stays wet and picks up nearly everything; acrylic dries as it goes;
    // gouache is meant to cover in one pass.
    const { oil, acrylic, gouache } = MEDIUM_PROFILES;
    expect(oil.pickUp).toBeGreaterThan(acrylic.pickUp);
    expect(acrylic.pickUp).toBeGreaterThan(gouache.pickUp);
    // …and oil lets go of what it carries the most slowly, which is why an oil
    // stroke across two colours is a gradient of both rather than a hard join.
    expect(oil.loadRate).toBeLessThan(acrylic.loadRate);
  });

  it('loads the bristles from paint, and from nothing else', () => {
    expect(pickUpLoad(null, RED, 0.5)).toEqual(RED);
    // Bare canvas is transparent black. Loading from it literally is what would
    // make a brush dragged over an empty layer paint a grey smear.
    expect(pickUpLoad(null, NOTHING, 0.5)).toBeNull();

    const overEmpty = pickUpLoad(RED, NOTHING, 0.5)!;
    expect(overEmpty.r).toBe(255);
    expect(overEmpty.a).toBeCloseTo(0.5);
  });

  it('turns the load over gradually rather than at every boundary', () => {
    let load = pickUpLoad(null, RED, 0.2);
    load = pickUpLoad(load, BLUE, 0.2);

    // One dab into the blue the bristles are still mostly red — which is the
    // whole difference between a loaded brush and a per-dab colour sample.
    expect(load!.r).toBeGreaterThan(load!.b);
    for (let i = 0; i < 30; i++) load = pickUpLoad(load, BLUE, 0.2);
    expect(load!.b).toBeGreaterThan(load!.r);
  });

  it('paints the brush’s own colour when the medium does not lift', () => {
    expect(dabColor(BLUE, RED, 0)).toBe(BLUE);
    expect(dabColor(BLUE, null, 0.9)).toBe(BLUE);
    // A load of nothing is nothing to mix in, however thirsty the medium.
    expect(dabColor(BLUE, { ...RED, a: 0 }, 0.9)).toBe(BLUE);
  });

  it('mixes towards the load without touching the paint’s own alpha', () => {
    const mixed = dabColor({ ...BLUE, a: 0.25 }, RED, 0.5);

    expect(mixed.r).toBeCloseTo(127.5);
    expect(mixed.b).toBeCloseTo(127.5);
    // How transparent the paint goes on was already settled by flow, opacity
    // and pressure; mixing decides the hue and nothing else.
    expect(mixed.a).toBe(0.25);
  });
});

describe('brush colours', () => {
  it('reads every form the colour picker and localStorage can produce', () => {
    expect(parseRgba('#f00')).toEqual(RED);
    expect(parseRgba('#ff0000')).toEqual(RED);
    expect(parseRgba('rgb(255, 0, 0)')).toEqual(RED);
    expect(parseRgba('rgba(255,0,0,0.5)')).toEqual({ ...RED, a: 0.5 });
    // Eight digits is what the picker emits once alpha is in play, and reading
    // it as "unrecognised" is what fringes a light stroke with a dark halo.
    expect(parseRgba('#ff000080')!.a).toBeCloseTo(0.502, 2);
    expect(parseRgba('cornflowerblue')).toBeNull();
  });

  it('drops the alpha from a css colour only when there is one to drop', () => {
    expect(rgbaToCss(RED)).toBe('rgb(255,0,0)');
    expect(rgbaToCss({ ...RED, a: 0.5 })).toBe('rgba(255,0,0,0.5)');
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('the material settings on a brush', () => {
  it('starts each preset on the surface and paint its tool implies', () => {
    expect(BRUSH_PRESETS.airbrush.splatter).toBeGreaterThan(0);
    expect(BRUSH_PRESETS.pencil.paper).toBe('cold-press');
    expect(BRUSH_PRESETS.brush.medium).toBe('acrylic');
    // Every other preset leaves the dab whole — splatter is the spray's alone.
    for (const type of ['pen', 'pencil', 'brush', 'marker', 'eraser'] as const) {
      expect(BRUSH_PRESETS[type].splatter).toBe(0);
    }
  });

  it('repairs a paper or a medium that no longer exists', () => {
    // A brush is restored from `localStorage`, so these arrive as whatever JSON
    // was last written there — including names from a build that spelled them
    // differently. Reaching the engine, an unknown one indexes to `undefined`
    // and takes the grain or the mixing with it.
    const repaired = clampBrush({
      ...createBrush('pencil'),
      paper: 'papyrus' as never,
      medium: 'enamel' as never,
      splatter: 4,
    });

    expect(repaired.paper).toBe('smooth');
    expect(repaired.medium).toBe('ink');
    expect(repaired.splatter).toBe(1);
  });

  it('keeps every medium and paper reachable from its own label list', () => {
    // The panel renders from these lists, so a member missing from one is a
    // setting that exists in the engine and cannot be chosen.
    expect(new Set(PAINT_MEDIUMS)).toEqual(new Set(Object.keys(MEDIUM_PROFILES)));
  });
});

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

interface Op {
  /** Which surface the operation was made on. */
  surface: number;
  op: GlobalCompositeOperation;
  alpha: number;
  fillStyle: unknown;
  /** For `drawImage`, the surface that was drawn. */
  source?: number;
}

/**
 * Recording surfaces that can also be *read* from.
 *
 * The existing paint-engine tests only need to know the compositing state of
 * each draw. A medium samples the layer, so this double answers `getImageData`
 * with a colour of the caller's choosing — that is the only way to assert that
 * an oil brush actually picked up what it was dragged through.
 */
function recordingSurfaces(layer: Rgba = NOTHING) {
  const ops: Op[] = [];
  let next = 0;

  const factory = (width: number, height: number) => {
    const id = next++;
    const surface = {
      id,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      getContext: () => ctx as unknown as CanvasRenderingContext2D,
      toDataURL: () => 'data:image/png;base64,PAINTED',
    };
    const record = (source?: number) => {
      ops.push({ surface: id, op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha, fillStyle: ctx.fillStyle, source });
    };
    const ctx = {
      canvas: surface,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      fillStyle: '' as unknown,
      save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
      setTransform: () => {}, translate: () => {}, clearRect: () => {}, rect: () => {},
      createImageData: (w: number, h: number) =>
        ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
      createPattern: () => ({ setTransform: () => {} }),
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = layer.r; data[i + 1] = layer.g; data[i + 2] = layer.b;
          data[i + 3] = Math.round(layer.a * 255);
        }
        return { data, width: w, height: h };
      },
      createRadialGradient: () => ({ addColorStop: () => {} }),
      arc: () => {},
      fill: () => record(),
      fillRect: () => record(),
      drawImage: (source: { id?: number }) => record(source?.id),
    };
    return surface;
  };

  return { ops, factory: factory as unknown as PaintSessionOptions['createSurface'] };
}

function session(brush: BrushSettings, extra: Partial<PaintSessionOptions> = {}, layer?: Rgba) {
  const surfaces = recordingSurfaces(layer);
  const instance = PaintSession.begin({
    rect: { x: 0, y: 0, width: 100, height: 100 },
    brush,
    createSurface: surfaces.factory,
    seed: 1,
    ...extra,
  })!;
  return { ...surfaces, session: instance };
}

/** No smoothing and wide spacing, so a test knows exactly how many dabs landed. */
function rigid(overrides: Partial<BrushSettings> = {}): BrushSettings {
  return clampBrush({ ...createBrush('pen'), smoothing: 0, spacing: 1, size: 10, ...overrides });
}

describe('a session painting with a material', () => {
  it('lays down a scatter of droplets for one splattered dab', () => {
    const plain = session(rigid({ splatter: 0 }));
    plain.session.begin(strokePoint(10, 10, 1));

    const sprayed = session(rigid({ splatter: 0.8 }));
    sprayed.session.begin(strokePoint(10, 10, 1));

    // One dab, one disc — against one dab, a dozen.
    expect(plain.ops.filter((o) => o.fillStyle !== undefined)).toHaveLength(1);
    expect(sprayed.ops.length).toBeGreaterThan(5);
  });

  it('takes the medium’s blend mode over the brush’s own', () => {
    const { session: paint, ops } = session(rigid({ medium: 'watercolor', blendMode: 'normal' }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    // A glaze multiplies or it is not a glaze — so the medium wins, and the
    // panel disables the Blend control rather than letting it silently stop
    // applying.
    expect(ops[ops.length - 1].op).toBe('multiply');
  });

  it('leaves the brush’s blend mode alone for a medium with no opinion', () => {
    const { session: paint, ops } = session(rigid({ medium: 'oil', blendMode: 'screen' }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    expect(ops[ops.length - 1].op).toBe('screen');
  });

  it('paints a mix of the brush’s colour and what it was dragged through', () => {
    const { session: paint, ops } = session(
      rigid({ medium: 'oil', color: '#0000ff', hardness: 1 }),
      {},
      RED,
    );
    paint.begin(strokePoint(10, 10, 1));
    paint.extend(strokePoint(90, 10, 1));

    const dab = parseRgba(String(ops[ops.length - 1].fillStyle))!;
    // Neither the blue that was picked nor the red that was there: oil carries
    // what it lifts, which is the whole of what choosing a medium buys.
    expect(dab.r).toBeGreaterThan(60);
    expect(dab.b).toBeGreaterThan(0);
    expect(dab.b).toBeLessThan(255);
    // …and it got there gradually, over the dabs, rather than at the first
    // pixel of the stroke.
    expect(dab.r).toBeGreaterThan(parseRgba(String(ops[0].fillStyle))!.r);
  });

  it('starts the stroke loaded with its own paint, not with the layer’s', () => {
    const { session: paint, ops } = session(
      rigid({ medium: 'oil', color: '#0000ff', hardness: 1 }),
      {},
      RED,
    );
    paint.begin(strokePoint(10, 10, 1));

    // A brush arrives at the canvas already loaded. Starting it empty makes the
    // first dab take the layer's colour whole, so a stroke begins as whatever
    // it happened to start on — before it has had the chance to pick anything
    // up — and the colour that was chosen never appears at all.
    const first = parseRgba(String(ops[0].fillStyle))!;
    expect(first.b).toBeGreaterThan(200);
    expect(first.r).toBeLessThan(80);
  });

  it('thins a glaze over the whole stroke, not just its dabs', () => {
    const glaze = session(rigid({ medium: 'watercolor', opacity: 1 }));
    glaze.session.begin(strokePoint(10, 10, 1));
    glaze.session.commit();

    const opaque = session(rigid({ medium: 'gouache', opacity: 1 }));
    opaque.session.begin(strokePoint(10, 10, 1));
    opaque.session.commit();

    expect(glaze.ops[glaze.ops.length - 1].alpha).toBeLessThan(1);
    expect(opaque.ops[opaque.ops.length - 1].alpha).toBe(1);
  });

  it('paints the colour that was picked when the medium does not lift', () => {
    const { session: paint, ops } = session(
      rigid({ medium: 'ink', color: '#0000ff', hardness: 1 }),
      {},
      RED,
    );
    paint.begin(strokePoint(10, 10, 1));

    expect(ops[0].fillStyle).toBe('#0000ff');
  });

  it('paints a mask in white whatever the medium would have mixed', () => {
    const { session: paint, ops } = session(
      rigid({ medium: 'oil', color: '#0000ff', hardness: 1 }),
      { mask: true },
      RED,
    );
    paint.begin(strokePoint(10, 10, 1));

    // A mask is a luminance channel. Mixing has no meaning in one, and a mask
    // painted in anything but white reads as its own brightness.
    expect(ops[0].fillStyle).toBe('#ffffff');
  });

  it('multiplies the paper’s tooth into the stroke, not into the layer', () => {
    const { session: paint, ops } = session(rigid({ paper: 'rough' }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    const grainOps = ops.filter((o) => o.op === 'destination-in');
    expect(grainOps.length).toBeGreaterThan(0);
    // On the copy of the stroke — never on the base, which holds the layer's
    // existing pixels and has to come through a grained stroke untouched. The
    // base is whatever the last composite drew onto.
    const base = ops.filter((o) => o.source !== undefined).pop()!.surface;
    expect(grainOps.every((o) => o.surface !== base)).toBe(true);
  });

  it('costs nothing at all on a smooth sheet', () => {
    const { session: paint, ops } = session(rigid({ paper: 'smooth', medium: 'ink' }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    // The common case: no tile, no pattern, no copy, and the stroke buffer
    // composited straight onto the layer.
    expect(ops.some((o) => o.op === 'destination-in')).toBe(false);
  });

  it('grains a watercolour stroke even on paper with no tooth', () => {
    const { session: paint, ops } = session(rigid({ paper: 'smooth', medium: 'watercolor' }));
    paint.begin(strokePoint(10, 10, 1));
    paint.commit();

    // Granulation is the pigment settling, which happens on a plate as much as
    // on a rough sheet.
    expect(ops.some((o) => o.op === 'destination-in')).toBe(true);
  });

  it('re-masks a copy each time, so a long stroke does not dissolve', () => {
    const { session: paint, ops } = session(rigid({ paper: 'rough' }));
    paint.begin(strokePoint(10, 10, 1));

    paint.preview();
    const afterFirst = ops.filter((o) => o.op === 'destination-in').length;
    paint.preview();
    const afterSecond = ops.filter((o) => o.op === 'destination-in').length;

    // Both masks multiply alpha, and the composite runs on every preview frame.
    // Applied in place they would multiply themselves once per frame and the
    // stroke would visibly fade over the course of a drag — so each composite
    // starts from a fresh copy of the stroke buffer, and the count going up is
    // the evidence that it did.
    expect(afterSecond).toBeGreaterThan(afterFirst);
    const copies = ops.filter((o) => o.op === 'source-over' && o.source !== undefined);
    expect(copies.length).toBeGreaterThanOrEqual(2);
  });
});

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
