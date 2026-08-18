/**
 * Tests for the docs editor's page-break geometry (PaginationExtension).
 *
 * The editor draws the document as one continuous sheet with grey gaps painted
 * between the pages, so without this the text flows straight through the bottom
 * margin, the gap and the next page's top margin. `computePageBreaks` decides
 * which blocks have to be pushed down and by how much; the plugin around it is
 * measurement and decoration plumbing.
 */

import { describe, it, expect } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import {
  computePageBreaks,
  measureBlocks,
  type BlockBox,
  type PageBreak,
  type PageMetrics,
} from '@/lib/extensions/PaginationExtension';

// US Letter at 96 dpi with 0.75in margins and the editor's 0.5in page gap.
const LETTER: PageMetrics = { pageHeight: 1056, marginTop: 72, marginBottom: 72, gap: 48 };
const USABLE = LETTER.pageHeight - LETTER.marginTop - LETTER.marginBottom; // 912
const STRIDE = LETTER.pageHeight + LETTER.gap;                            // 1104

/** Stack blocks of the given heights back to back, as the browser would. */
function stack(heights: number[]): BlockBox[] {
  let top = 0;
  return heights.map((height, i) => {
    const box = { pos: i, top, height };
    top += height;
    return box;
  });
}

/** Apply the computed breaks to get where each block actually ends up. */
function layout(blocks: BlockBox[], metrics: PageMetrics) {
  const breaks = computePageBreaks(blocks, metrics);
  let shift = 0;
  return blocks.map(b => {
    const brk = breaks.find(x => x.pos === b.pos);
    if (brk) shift += brk.height;
    return { pos: b.pos, top: b.top + shift, bottom: b.top + shift + b.height };
  });
}

/** The printable band of page `k`, in the same coordinates as `layout`. */
function band(k: number) {
  return { start: k * STRIDE, end: k * STRIDE + USABLE };
}

describe('computePageBreaks', () => {
  it('leaves a document that fits on one page alone', () => {
    expect(computePageBreaks(stack([100, 200, 300]), LETTER)).toEqual([]);
  });

  it('pushes a block that would straddle the bottom margin onto the next page', () => {
    // Ten 100px blocks: the tenth spans 900–1000, crossing the 912 band end.
    const breaks = computePageBreaks(stack(Array(10).fill(100)), LETTER);

    expect(breaks).toHaveLength(1);
    expect(breaks[0].pos).toBe(9);
    // Lands exactly at the top of page 2's content area.
    expect(900 + breaks[0].height).toBe(band(1).start);
  });

  it('pushes a block that would start inside the gap between sheets', () => {
    // First block fills the printable area exactly; the second would start at
    // 912 — inside the bottom margin, above the grey gap.
    const [placed] = layout(stack([USABLE, 100]), LETTER).slice(1);

    expect(placed.top).toBe(band(1).start);
  });

  it('keeps every block inside a printable band, never in a margin or gap', () => {
    // Mixed heights across several pages, including blocks that land right on
    // boundaries.
    const heights = [300, 400, 250, 180, 912, 90, 500, 600, 120, 700, 60];
    const placed = layout(stack(heights), LETTER);

    for (const block of placed) {
      const page = Math.floor(block.top / STRIDE);
      const { start, end } = band(page);
      expect(block.top).toBeGreaterThanOrEqual(start);
      expect(block.bottom).toBeLessThanOrEqual(end);
    }
  });

  it('lets a block taller than the printable area overflow rather than looping', () => {
    // A full-page image cannot be rescued by a spacer — nothing to do but let
    // it run, and resume the next block on a clean page after it.
    const blocks = stack([100, USABLE * 2, 100]);
    const breaks = computePageBreaks(blocks, LETTER);

    // The tall block is moved to a page start (it began mid-page) so as much of
    // it as possible is printable, but no attempt is made to make it fit.
    expect(breaks.map(b => b.pos)).toEqual([1]);

    const placed = layout(blocks, LETTER);
    expect(placed[1].top % STRIDE).toBe(0);

    // The block after it resumes immediately below, on whatever page the
    // overflow ended on, and inside that page's printable band.
    const page = Math.floor(placed[2].top / STRIDE);
    expect(placed[2].top).toBe(placed[1].bottom);
    expect(placed[2].top).toBeGreaterThanOrEqual(band(page).start);
    expect(placed[2].bottom).toBeLessThanOrEqual(band(page).end);
  });

  it('is stable: re-running against natural coordinates gives the same breaks', () => {
    // The plugin re-measures after every change and subtracts its own spacers
    // to recover natural coordinates. If a second pass disagreed with the
    // first, the editor would oscillate on every keystroke.
    const blocks = stack([300, 400, 250, 180, 90, 500, 600, 120]);
    const first = computePageBreaks(blocks, LETTER);
    const second = computePageBreaks(blocks, LETTER);

    expect(second).toEqual(first);
  });

  it('re-breaks for a different paper size', () => {
    const a5: PageMetrics = { pageHeight: 794, marginTop: 48, marginBottom: 48, gap: 48 };
    const blocks = stack(Array(10).fill(100));

    // A5's printable column is 698px, so the break comes earlier than Letter's.
    const letterBreak = computePageBreaks(blocks, LETTER)[0];
    const a5Break = computePageBreaks(blocks, a5)[0];

    expect(a5Break.pos).toBeLessThan(letterBreak.pos);
  });

  it('produces nothing for degenerate metrics instead of dividing by zero', () => {
    const noRoom: PageMetrics = { pageHeight: 100, marginTop: 60, marginBottom: 60, gap: 48 };
    expect(computePageBreaks(stack([50, 50]), noRoom)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Splitting paragraphs across a boundary (the opt-in setting)
// ---------------------------------------------------------------------------

const SPLIT: PageMetrics = { ...LETTER, splitParagraphs: true };

const LINE_HEIGHT = 16;
const LINE_SPACING = 24;

/**
 * A text block with `lineCount` lines, laid out like a real paragraph: the
 * first line sits a few px below the box top and the box runs a few px past the
 * last line (half-leading).
 */
function paragraph(pos: number, top: number, lineCount: number): BlockBox {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    // Line positions are inside the block, one per line.
    pos: pos + 1 + i * 50,
    offset: 3 + i * LINE_SPACING,
    height: LINE_HEIGHT,
  }));
  return { pos, top, height: 3 + (lineCount - 1) * LINE_SPACING + LINE_HEIGHT + 4, lines };
}

/** Where each line ends up once the computed spacers are applied. */
function layoutLines(blocks: BlockBox[], metrics: PageMetrics) {
  const breaks = computePageBreaks(blocks, metrics);
  const shiftAt = (pos: number) =>
    breaks.filter(b => b.pos <= pos).reduce((sum, b) => sum + b.height, 0);

  return blocks.flatMap(block =>
    (block.lines ?? []).map(line => ({
      pos: line.pos,
      top: block.top + line.offset + shiftAt(line.pos),
      bottom: block.top + line.offset + line.height + shiftAt(line.pos),
    })),
  );
}

describe('computePageBreaks — paragraph splitting', () => {
  // A paragraph starting 60px above the end of page 1's printable column: its
  // first two lines fit, the rest do not.
  const straddling = () => [paragraph(0, 0, 3), paragraph(500, USABLE - 60, 4)];

  it('moves the whole paragraph when the setting is off, even with lines measured', () => {
    const breaks = computePageBreaks(straddling(), LETTER);

    expect(breaks).toHaveLength(1);
    expect(breaks[0].pos).toBe(500); // the block, not a line inside it
  });

  it('breaks at the first line that does not fit when the setting is on', () => {
    const blocks = straddling();
    const breaks = computePageBreaks(blocks, SPLIT);

    expect(breaks).toHaveLength(1);
    // A line position inside the paragraph, not the paragraph itself.
    const lines = blocks[1].lines!;
    expect(breaks[0].pos).toBeGreaterThan(blocks[1].pos);
    expect(lines.some(l => l.pos === breaks[0].pos)).toBe(true);

    // The lines above it stay on page 1; that line lands on page 2.
    const placed = layoutLines(blocks, SPLIT);
    const moved = placed.find(l => l.pos === breaks[0].pos)!;
    expect(moved.top).toBe(STRIDE);
  });

  it('keeps every line inside a printable band', () => {
    const blocks = [];
    let top = 0;
    for (let i = 0; i < 40; i++) {
      blocks.push(paragraph(i * 500, top, (i % 4) + 1));
      top += blocks[i].height + 4;
    }

    for (const line of layoutLines(blocks, SPLIT)) {
      const page = Math.floor(line.top / STRIDE);
      expect(line.top).toBeGreaterThanOrEqual(band(page).start);
      expect(line.bottom).toBeLessThanOrEqual(band(page).end);
    }
  });

  it('moves the paragraph whole when it is the first line that does not fit', () => {
    // Nothing is left behind by breaking before line one, so this is not a
    // split — the spacer belongs in front of the block.
    const blocks = [paragraph(0, 0, 3), paragraph(500, USABLE - 8, 3)];
    const breaks = computePageBreaks(blocks, SPLIT);

    expect(breaks).toHaveLength(1);
    expect(breaks[0].pos).toBe(500);
  });

  it('moves a single-line block whole — there is nothing to split', () => {
    // A heading that straddles the boundary.
    const blocks = [paragraph(0, 0, 3), paragraph(500, USABLE - 10, 1)];
    const breaks = computePageBreaks(blocks, SPLIT);

    expect(breaks).toHaveLength(1);
    expect(breaks[0].pos).toBe(500);
  });

  it('splits a paragraph long enough to cross several boundaries', () => {
    // 120 lines ≈ three printable columns.
    const blocks = [paragraph(0, 0, 120)];
    const breaks = computePageBreaks(blocks, SPLIT);

    expect(breaks.length).toBeGreaterThanOrEqual(2);
    for (const line of layoutLines(blocks, SPLIT)) {
      const page = Math.floor(line.top / STRIDE);
      expect(line.bottom).toBeLessThanOrEqual(band(page).end);
    }
  });

  it('does not count a box that outruns its last line as a page crossing', () => {
    // A text block's box is a few px taller than its last line (half-leading).
    // This paragraph's lines all fit page 1; only its box pokes into the
    // margin. Treating that as a crossing would advance the page counter, and
    // then everything after it measures itself against a page it is not on —
    // silently stranding whole paragraphs in the margin and the gap.
    const first = paragraph(0, USABLE - 69, 3);   // last line ends at USABLE-2, box at USABLE+2
    const second = paragraph(500, USABLE + 6, 3); // starts inside the bottom margin

    expect(computePageBreaks([first, second], SPLIT)).toEqual([
      { pos: 500, height: STRIDE - (USABLE + 6) },
    ]);

    for (const line of layoutLines([first, second], SPLIT)) {
      const page = Math.floor(line.top / STRIDE);
      expect(line.top).toBeGreaterThanOrEqual(band(page).start);
      expect(line.bottom).toBeLessThanOrEqual(band(page).end);
    }
  });

  it('is stable across re-runs', () => {
    const blocks = [paragraph(0, 0, 5), paragraph(500, 130, 12), paragraph(1500, 450, 30)];
    expect(computePageBreaks(blocks, SPLIT)).toEqual(computePageBreaks(blocks, SPLIT));
  });
});

// ---------------------------------------------------------------------------
// measureBlocks — recovering natural coordinates from what is on screen
// ---------------------------------------------------------------------------

/**
 * A stand-in for the pieces of EditorView the measurement touches: a root
 * element, one element per top-level block, and rects positioned as a browser
 * would report them (viewport coordinates, scaled by the editor's zoom).
 */
function fakeView(opts: {
  /** On-screen top/height of each block, already scaled. */
  rects: { top: number; height: number }[];
  rootTop: number;
  /** Zoom factor applied by DocEditor's CSS transform. */
  scale: number;
  /** Unscaled width of the editor element. */
  width: number;
  /** Document positions of the blocks; defaults to one position each. */
  positions?: number[];
  /** Size of each block in the document, for locating breaks inside one. */
  nodeSize?: number;
}): EditorView {
  const rect = (top: number, height: number) =>
    ({ top, height, width: opts.width * opts.scale }) as DOMRect;

  const doms = opts.rects.map((r, i) => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => rect(r.top, r.height);
    return { pos: opts.positions?.[i] ?? i, el };
  });

  const root = document.createElement('div');
  root.getBoundingClientRect = () => rect(opts.rootTop, 0);
  Object.defineProperty(root, 'offsetWidth', { value: opts.width });

  return {
    dom: root,
    nodeDOM: (pos: number) => doms.find(d => d.pos === pos)?.el ?? null,
    state: { doc: { forEach: (fn: (node: unknown, offset: number) => void) => {
      doms.forEach(d => fn({ nodeSize: opts.nodeSize ?? 1, isTextblock: false }, d.pos));
    } } },
  } as unknown as EditorView;
}

describe('measureBlocks', () => {
  it('reports offsets from the top of the content, not the viewport', () => {
    const view = fakeView({
      rootTop: 300,           // editor scrolled down the screen
      rects: [{ top: 300, height: 100 }, { top: 400, height: 250 }],
      scale: 1,
      width: 816,
    });

    expect(measureBlocks(view, [])).toEqual([
      { pos: 0, top: 0, height: 100 },
      { pos: 1, top: 100, height: 250 },
    ]);
  });

  it('divides out the zoom transform', () => {
    // At 50% zoom every rect a browser reports is half size; the page geometry
    // the breaks are computed against is not.
    const view = fakeView({
      rootTop: 0,
      rects: [{ top: 0, height: 50 }, { top: 50, height: 125 }],
      scale: 0.5,
      width: 816,
    });

    expect(measureBlocks(view, [])).toEqual([
      { pos: 0, top: 0, height: 100 },
      { pos: 1, top: 100, height: 250 },
    ]);
  });

  it('subtracts the spacers it already inserted, recovering natural tops', () => {
    // Same document as the first test, but with a 204px spacer in front of the
    // second block: on screen it now starts at 604, naturally still at 100.
    const breaks: PageBreak[] = [{ pos: 1, height: 204 }];
    const view = fakeView({
      rootTop: 300,
      rects: [{ top: 300, height: 100 }, { top: 604, height: 250 }],
      scale: 1,
      width: 816,
    });

    expect(measureBlocks(view, breaks)).toEqual([
      { pos: 0, top: 0, height: 100 },
      { pos: 1, top: 100, height: 250 },
    ]);
  });

  it('takes a spacer that split a block back out of that block\'s height', () => {
    // A split paragraph renders taller than it is by the spacer inside it.
    // Counted as real height, it would look like a block that crosses a page
    // boundary, and every page after it would be counted from the wrong place.
    const breaks: PageBreak[] = [{ pos: 60, height: 100 }];
    const view = fakeView({
      rootTop: 0,
      rects: [{ top: 0, height: 250 }, { top: 250, height: 40 }],
      positions: [0, 200],
      nodeSize: 200,
      scale: 1,
      width: 816,
    });

    expect(measureBlocks(view, breaks)).toEqual([
      { pos: 0, top: 0, height: 150 },   // 250 on screen, 100 of it spacer
      { pos: 200, top: 150, height: 40 },
    ]);
  });

  it('round-trips: measuring a laid-out document reproduces its own breaks', () => {
    // The convergence property the plugin depends on — measure, break,
    // re-measure, and the second pass agrees, so it stops dispatching.
    const natural = stack([300, 400, 250, 180, 90, 500, 600, 120]);
    const breaks = computePageBreaks(natural, LETTER);

    let shift = 0;
    const onScreen = natural.map(b => {
      const brk = breaks.find(x => x.pos === b.pos);
      if (brk) shift += brk.height;
      return { top: b.top + shift, height: b.height };
    });

    const remeasured = measureBlocks(
      fakeView({ rootTop: 0, rects: onScreen, scale: 1, width: 816 }),
      breaks,
    );

    expect(remeasured).toEqual(natural);
    expect(computePageBreaks(remeasured, LETTER)).toEqual(breaks);
  });
});
