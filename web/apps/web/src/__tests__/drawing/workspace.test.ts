/**
 * Workspace metadata — redesign phase 8.
 *
 * Guides, grids, snapping, rulers, the active selection and the viewport.
 * §5 is explicit that none of it is image content, and the tests are shaped by
 * that: what is checked is that the state survives a save, that a reader
 * ignoring it loses nothing about the picture, and that the two pieces with
 * real arithmetic behind them — unit conversion and tick spacing — are right at
 * the zoom levels where they are hardest.
 *
 * The tick spacing is the one that looks trivial and is not. A ruler has to
 * stay readable from 8% to 1600%, which means the step has to grow in canvas
 * units exactly as fast as the zoom shrinks them on screen, and it has to land
 * on numbers people rule in rather than on whatever the arithmetic produced.
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_SNAP,
  DEFAULT_WORKSPACE,
  formatMeasure,
  fromUnits,
  pixelsPerUnit,
  RULER_UNITS,
  rulerTicks,
  snapCandidates,
  snapValue,
  toUnits,
  workspaceOf,
} from '../../app/(apps)/drawing/editor/document/workspace';
import { createDocument } from '../../app/(apps)/drawing/editor/document/factory';
import {
  addGuide,
  clearGuides,
  moveGuide,
  removeGuide,
  setSnap,
  setViewport,
  setWorkspace,
} from '../../app/(apps)/drawing/editor/document/edits';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { buildManifest } from '../../app/(apps)/drawing/editor/io/ora/manifest';
import { documentToSvg } from '../../app/(apps)/drawing/editor/render/documentSvg';

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

describe('ruler units', () => {
  it('derives every physical unit from the document DPI', () => {
    // The point of the canvas carrying a DPI at all: without this it is a
    // number written into `stack.xml` and never read.
    expect(pixelsPerUnit('in', 300)).toBe(300);
    expect(pixelsPerUnit('cm', 254)).toBeCloseTo(100);
    expect(pixelsPerUnit('mm', 254)).toBeCloseTo(10);
    expect(pixelsPerUnit('px', 300)).toBe(1);
  });

  it('defines points and picas from the inch rather than tabulating them', () => {
    expect(pixelsPerUnit('pt', 72)).toBe(1);
    expect(pixelsPerUnit('pc', 72)).toBe(12);
  });

  it('round-trips a measurement through a unit', () => {
    for (const unit of RULER_UNITS) {
      expect(fromUnits(toUnits(1000, unit, 96), unit, 96)).toBeCloseTo(1000);
    }
  });

  it('falls back to 96 DPI rather than dividing by zero', () => {
    // A hand-edited document can say anything; an infinite pixels-per-unit
    // makes every ruler tick land at the same place.
    expect(Number.isFinite(pixelsPerUnit('cm', 0))).toBe(true);
  });

  it('shows as much precision as the unit deserves', () => {
    expect(formatMeasure(1920, 'px', 96)).toBe('1920 px');
    expect(formatMeasure(96, 'in', 96)).toBe('1.00 in');
    expect(formatMeasure(96, 'mm', 96)).toBe('25.4 mm');
  });
});

// ---------------------------------------------------------------------------
// Ruler ticks
// ---------------------------------------------------------------------------

describe('ruler ticks', () => {
  it('keeps labelled ticks at least the minimum apart on screen at every zoom', () => {
    for (const scale of [0.08, 0.25, 1, 4, 16]) {
      const { step } = rulerTicks('px', 96, scale, 64);
      expect(step * scale, `scale ${scale}`).toBeGreaterThanOrEqual(64);
    }
  });

  it('chooses steps from the 1-2-5 series people rule in', () => {
    // Not 37 or 63: a ruler marked at arbitrary intervals is one nobody can
    // read a position off.
    for (const scale of [0.1, 0.3, 0.7, 1, 2.5, 9]) {
      const { step } = rulerTicks('px', 96, scale, 64);
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-6), `step ${step}`).toBe(true);
    }
  });

  it('grows the step as the zoom shrinks', () => {
    expect(rulerTicks('px', 96, 0.1).step).toBeGreaterThan(rulerTicks('px', 96, 1).step);
    expect(rulerTicks('px', 96, 8).step).toBeLessThan(rulerTicks('px', 96, 1).step);
  });

  it('divides a step of five into five, and everything else into four', () => {
    // A 5 cm step divided into four is 1.25 cm, which is not a mark anyone
    // reads off a ruler.
    const ticks = rulerTicks('px', 96, 0.14, 64);
    const mantissa = ticks.step / Math.pow(10, Math.floor(Math.log10(ticks.step)));
    expect(ticks.subdivisions).toBe(mantissa === 5 ? 5 : 4);
  });

  it('measures in the chosen unit, not in pixels', () => {
    // At 300 DPI an inch is 300 pixels, so the step in *canvas* units has to be
    // that much larger for the same spacing on screen.
    const inches = rulerTicks('in', 300, 1, 64);
    const pixels = rulerTicks('px', 300, 1, 64);
    expect(inches.step).toBeGreaterThan(pixels.step);
  });
});

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

describe('snapping', () => {
  it('takes the nearest candidate, not the first', () => {
    // Two guides a few pixels apart would otherwise be decided by the order
    // they were created in, which nobody can see.
    expect(snapValue(103, [110, 100], 20)).toBe(100);
    expect(snapValue(108, [110, 100], 20)).toBe(110);
  });

  it('leaves a value alone when nothing is within tolerance', () => {
    expect(snapValue(50, [100, 200], 8)).toBe(50);
  });

  it('offers the canvas edges and its centre line', () => {
    const candidates = snapCandidates('x', {
      canvas: { width: 800, height: 600 },
      settings: { ...DEFAULT_SNAP, guides: false, objects: false, canvas: true },
    });
    expect(candidates).toEqual([0, 400, 800]);
  });

  it('crosses the guide orientation over exactly once', () => {
    // A vertical guide is a line of constant x, so it is a candidate on the x
    // axis. Getting this backwards makes every guide snap on the wrong axis.
    const guides = [
      { orientation: 'vertical' as const, position: 120 },
      { orientation: 'horizontal' as const, position: 300 },
    ];
    const settings = { ...DEFAULT_SNAP, canvas: false, objects: false, guides: true };
    expect(snapCandidates('x', { guides, settings })).toEqual([120]);
    expect(snapCandidates('y', { guides, settings })).toEqual([300]);
  });

  it('offers the edges and the centre of each object', () => {
    const rects = [{ x: 10, y: 0, width: 100, height: 40 }];
    const settings = { ...DEFAULT_SNAP, canvas: false, guides: false, objects: true };
    expect(snapCandidates('x', { rects, settings })).toEqual([10, 60, 110]);
    expect(snapCandidates('y', { rects, settings })).toEqual([0, 20, 40]);
  });

  it('offers nothing for a rule that is switched off', () => {
    const settings = { ...DEFAULT_SNAP, canvas: false, guides: false, objects: false };
    expect(snapCandidates('x', {
      canvas: { width: 10, height: 10 },
      guides: [{ orientation: 'vertical', position: 5 }],
      rects: [{ x: 0, y: 0, width: 4, height: 4 }],
      settings,
    })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

describe('guides', () => {
  it('adds, moves, removes and clears', () => {
    const added = addGuide(createDocument(), { orientation: 'vertical', position: 100 });
    const id = added.guides[0].id;
    expect(moveGuide(added, id, 250).guides[0].position).toBe(250);
    expect(removeGuide(added, id).guides).toHaveLength(0);
    expect(clearGuides(added).guides).toHaveLength(0);
  });

  it('leaves a document with no guides untouched when cleared', () => {
    // Identity, not a copy: clearing nothing must not be an undo step.
    const doc = createDocument();
    expect(clearGuides(doc)).toBe(doc);
  });

  it('survives a save', () => {
    const doc = addGuide(addGuide(createDocument(), { orientation: 'vertical', position: 100 }),
      { orientation: 'horizontal', position: 40 });
    const reopened = parseDocument(serializeDocument(doc))!;
    expect(reopened.guides.map((g) => [g.orientation, g.position]))
      .toEqual([['vertical', 100], ['horizontal', 40]]);
  });
});

// ---------------------------------------------------------------------------
// The workspace block
// ---------------------------------------------------------------------------

describe('workspace state', () => {
  it('round-trips rulers, units, snapping, rotation and what was open', () => {
    const doc = setWorkspace(setViewport(createDocument(), { x: -40, y: 12, scale: 2.5 }), {
      rulers: false,
      units: 'cm',
      lockGuides: true,
      canvasRotation: 90,
      activeTool: 'pencil',
      activeLayerId: 'layer-7',
      selectedIds: ['a', 'b'],
    });

    const reopened = parseDocument(serializeDocument(setSnap(doc, { objects: true })))!;
    const workspace = workspaceOf(reopened.workspace);
    expect(workspace.rulers).toBe(false);
    expect(workspace.units).toBe('cm');
    expect(workspace.lockGuides).toBe(true);
    expect(workspace.canvasRotation).toBe(90);
    expect(workspace.activeTool).toBe('pencil');
    expect(workspace.activeLayerId).toBe('layer-7');
    expect(workspace.selectedIds).toEqual(['a', 'b']);
    expect(workspace.snap.objects).toBe(true);
    expect(reopened.viewport).toEqual({ x: -40, y: 12, scale: 2.5 });
  });

  it('wraps a rotation rather than clamping it', () => {
    // An angle is an angle: −90 and 270 are the same view, and clamping would
    // make turning the canvas anticlockwise past zero stick.
    const raw = JSON.stringify({ ...createDocument(), workspace: { canvasRotation: -90 } });
    expect(workspaceOf(parseDocument(raw)!.workspace).canvasRotation).toBe(270);
  });

  it('falls back for a unit this build does not have', () => {
    const raw = JSON.stringify({ ...createDocument(), workspace: { units: 'furlongs' } });
    expect(workspaceOf(parseDocument(raw)!.workspace).units).toBe(DEFAULT_WORKSPACE.units);
  });

  it('fills in defaults for a document written before the block existed', () => {
    const { workspace: _dropped, ...older } = createDocument();
    const reopened = parseDocument(JSON.stringify(older))!;
    expect(reopened.workspace).toBeUndefined();
    // Every reader goes through `workspaceOf`, so "absent" and "default" behave
    // identically and no call site has to check.
    expect(workspaceOf(reopened.workspace)).toEqual(DEFAULT_WORKSPACE);
  });

  it('clamps a viewport scale that would be unusable', () => {
    const raw = JSON.stringify({ ...createDocument(), viewport: { x: 0, y: 0, scale: 1e9 } });
    expect(parseDocument(raw)!.viewport!.scale).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Not image content
// ---------------------------------------------------------------------------

describe('workspace state is not image content', () => {
  it('travels in the Neutrino manifest, where another reader ignores it', () => {
    const doc = setWorkspace(addGuide(createDocument(), { orientation: 'vertical', position: 42 }), {
      units: 'mm',
      canvasRotation: 45,
    });
    const manifest = buildManifest(doc, new Map(), new Map());
    expect(manifest.document.guides[0].position).toBe(42);
    expect(manifest.document.workspace?.units).toBe('mm');
  });

  it('changes nothing about an exported picture', () => {
    // A rotated *view* must not rotate the drawing, and a guide must not be
    // drawn into the file. Both would be silent: the export would simply be
    // wrong, and only against the original.
    const plain = createDocument({ canvas: { width: 100, height: 80 } });
    const dressed = setWorkspace(addGuide(plain, { orientation: 'vertical', position: 20 }), {
      canvasRotation: 45,
      rulers: true,
    });
    expect(documentToSvg(dressed)).toBe(documentToSvg(plain));
  });
});
