/**
 * PaginationExtension — keeps content inside each page's printable area.
 *
 * The editor renders the document as one continuous sheet with the gaps
 * between pages painted on as a background gradient (DocEditor's
 * `pageGapBackground`), so nothing in the text flow knows where a page ends: a
 * paragraph runs straight through the bottom margin, across the grey gap, and
 * out of the top margin of the next page.
 *
 * This plugin measures every top-level block after a change and inserts a
 * spacer in front of any block that would straddle a boundary, pushing it down
 * to the top of the next page's content area. The spacer is a **widget
 * decoration**, not a node: where a page breaks is a function of the current
 * paper size and margins, and writing it into the document would serialise it
 * into the file — fossilising today's page setup in a document opened
 * tomorrow at a different one (and, for Docs, sending it to every collaborator
 * through the Y.Doc).
 *
 * By default a paragraph moves whole rather than breaking across the boundary
 * — the trade a word processor calls "keep lines together". `splitParagraphs`
 * turns the other behaviour on: the lines that fit stay where they are and the
 * spacer goes in front of the first line that doesn't, *inside* the paragraph,
 * as a block box that pushes the rest of the text onto the next page. Splitting
 * only ever happens between line boxes, so the text reflows identically either
 * way; nothing re-wraps.
 *
 * A paragraph *taller than a whole page* splits whichever way the setting is
 * left: keeping it together is not a trade at that point but an impossibility,
 * and a paragraph with nowhere to be kept together just runs off the sheet.
 *
 * The one case neither mode can fix: a block with no line boxes to break
 * between that is still taller than the printable area — a full-page image, a
 * long table, a single line in a huge font. No spacer rescues it, so it is left
 * to overflow and the pages after it are counted from where it actually ends.
 *
 * The plugin also owns the **page count**, reported through the `onPageCount`
 * option. It is the only measurement that can be right: the editor's own sheet
 * has a `min-height` derived from the page count, so counting pages from that
 * element's height is a loop that can only ratchet upwards — one page too many
 * makes the sheet taller, which keeps the count there for good.
 */

import { Extension } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** Page geometry, in CSS px at the editor's 96 dpi screen scale. */
export interface PageMetrics {
  /** Full sheet height (paper height), excluding the gap that follows it. */
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  /** Blank space rendered between two sheets. */
  gap: number;
  /**
   * Break a paragraph across the boundary at the last line that fits, instead
   * of moving the whole paragraph to the next page. Off by default: a
   * paragraph kept whole never leaves a line stranded on its own, and word
   * processors call the same trade "keep lines together".
   */
  splitParagraphs?: boolean;
}

/** A spacer to render before the block at `pos`. */
export interface PageBreak {
  pos: number;
  height: number;
}

/** One line box inside a text block, in that block's own coordinates. */
export interface LineBox {
  /** Document position of the line's first character. */
  pos: number;
  /** Offset of the line's top from the top of its block. */
  offset: number;
  height: number;
}

/** One top-level block, measured in spacer-free ("natural") flow coordinates. */
export interface BlockBox {
  pos: number;
  /** Offset from the top of the content area of page 1. */
  top: number;
  height: number;
  /**
   * The block's line boxes, measured only for text blocks and only when
   * splitting is on — a block with no lines is always moved whole.
   */
  lines?: LineBox[];
}

// Sub-pixel slack. Measured rects are fractional, and a paragraph that ends
// 0.3px past the margin has not really overflowed the page.
const EPSILON = 0.5;

export const paginationPluginKey = new PluginKey<PaginationState>('pagination');

interface PaginationState {
  metrics: PageMetrics | null;
  breaks: PageBreak[];
  decorations: DecorationSet;
}

export interface PaginationOptions {
  /**
   * Called with the number of pages the content occupies whenever it changes.
   * The editor draws that many sheets; see the module comment for why it cannot
   * work the number out from the rendered height itself.
   */
  onPageCount: ((pages: number) => void) | null;
}

/** The spacers a document needs, and how many pages it ends up occupying. */
export interface Pagination {
  breaks: PageBreak[];
  pages: number;
}

/**
 * Where each page's content band starts and ends, in flow coordinates whose
 * origin is the top of page 1's content area. Page k occupies
 * `[k*stride, k*stride + usable]`; the `stride - usable` between two bands is
 * the bottom margin, the gap, and the next top margin — the dead zone content
 * must not be rendered into.
 */
function bands(m: PageMetrics): { stride: number; usable: number } {
  return {
    stride: m.pageHeight + m.gap,
    usable: m.pageHeight - m.marginTop - m.marginBottom,
  };
}

/**
 * The spacers needed to keep `blocks` inside the printable bands.
 *
 * `blocks` are in natural coordinates — measured as if no spacer existed —
 * which is what makes this stable to re-run: feeding it the same document
 * twice yields the same breaks whether or not the previous pass's spacers are
 * on screen, so the measure → decorate → measure loop settles instead of
 * oscillating.
 */
export function computePageBreaks(blocks: BlockBox[], metrics: PageMetrics): PageBreak[] {
  return paginate(blocks, metrics).breaks;
}

/**
 * `computePageBreaks` plus the page count that falls out of the same walk — the
 * page the last block ends on, which is the only place that knows where the
 * content really finishes once every spacer is in.
 */
export function paginate(blocks: BlockBox[], metrics: PageMetrics): Pagination {
  const { stride, usable } = bands(metrics);
  const breaks: PageBreak[] = [];
  if (!(stride > 0) || !(usable > 0)) return { breaks, pages: 1 };

  let page = 0;
  let shift = 0;

  for (const block of blocks) {
    let top = block.top + shift;
    const bandEnd = page * stride + usable;
    const startsInDeadZone = top >= bandEnd - EPSILON;
    const overflowsBand = top + block.height > bandEnd + EPSILON;
    // A block too tall to fit anywhere still starts on a fresh page: that runs
    // the most of it through printable space before it crosses a gap. Only
    // when it is already at a page top is there nothing left to gain — and
    // moving it again would push it down a page per pass, forever.
    const atPageStart = Math.abs(top - page * stride) <= EPSILON;
    // Splitting keeps the lines that fit where they are, so the block itself
    // only moves when it starts somewhere unprintable.
    const splittable = overflowsBand && canSplit(block, usable, metrics.splitParagraphs);

    if (startsInDeadZone || (overflowsBand && !atPageStart && !splittable)) {
      const spacer = (page + 1) * stride - top;
      if (spacer > EPSILON) {
        breaks.push({ pos: block.pos, height: spacer });
        shift += spacer;
        top += spacer;
      }
      page += 1;
    }

    if (splittable) {
      // Walk the lines, breaking at the last one that fits.
      let inner = 0;
      block.lines!.forEach((line, index) => {
        const lineTop = top + line.offset + inner;
        if (lineTop + line.height > page * stride + usable + EPSILON) {
          const spacer = (page + 1) * stride - lineTop;
          if (spacer > EPSILON) {
            // Breaking before the *first* line is not a split — there is
            // nothing above it to leave behind — so the spacer goes in front of
            // the block and the paragraph moves whole. Its later lines are
            // still split off from wherever it lands.
            breaks.push({ pos: index === 0 ? block.pos : line.pos, height: spacer });
            inner += spacer;
          }
          page += 1;
        }
      });
      shift += inner;
      top += inner;
      // `page` now tracks the last line, which is what the next block has to
      // follow. Deliberately not re-derived from the block's box: a text block
      // is a few pixels taller than its last line (half-leading), and counting
      // that as a page crossing would leave the following blocks measuring
      // themselves against a page they are not on — and so never break at all.
      continue;
    }

    // Whatever page it now sits on, step past every band it spills over. Only
    // a block taller than the printable area can do this.
    while (top + block.height > page * stride + usable + EPSILON) page += 1;
  }

  // `page` is the page the last block ends on; pages are counted from it rather
  // than from the document's rendered height, which the sheet's own min-height
  // inflates.
  return { breaks, pages: page + 1 };
}

/**
 * Whether a block can be broken between its lines rather than moved whole.
 * Needs at least two lines to break between and lines that each fit a page on
 * their own.
 *
 * The setting only governs paragraphs that *could* be moved whole. One taller
 * than the printable area could not: "keep lines together" has no page to keep
 * them together on, and honouring it there means the paragraph runs through the
 * bottom margin, the gap and every sheet after it — so it splits either way.
 */
function canSplit(block: BlockBox, usable: number, enabled?: boolean): boolean {
  const lines = block.lines;
  if (!lines || lines.length < 2) return false;
  if (!enabled && block.height <= usable + EPSILON) return false;
  return lines.every(l => l.height <= usable + EPSILON);
}

function spacerElement(height: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-page-spacer', String(Math.round(height)));
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${height}px`;
  el.style.pointerEvents = 'none';
  el.style.userSelect = 'none';
  // Explicit, because a spacer that splits a paragraph sits *inside* it: only a
  // block box breaks the line flow and pushes the rest of the text down.
  el.style.display = 'block';
  el.style.width = '100%';
  return el;
}

function buildDecorations(doc: ProseMirrorNode, breaks: PageBreak[]): DecorationSet {
  return DecorationSet.create(
    doc,
    breaks.map(b =>
      Decoration.widget(b.pos, () => spacerElement(b.height), {
        // Before the block it pushes down, and never part of a selection or a
        // click target — it is blank space, not content.
        side: -1,
        key: `page-spacer-${Math.round(b.height)}`,
        ignoreSelection: true,
      }),
    ),
  );
}

function sameBreaks(a: PageBreak[], b: PageBreak[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.pos === b[i].pos && Math.abs(x.height - b[i].height) <= 1);
}

/**
 * Measure the top-level blocks, undoing both the zoom transform and this
 * plugin's own spacers so the result is in natural flow coordinates.
 *
 * Exported for tests: this is the half `computePageBreaks` trusts, and getting
 * either correction wrong is invisible until a document at 50% zoom breaks in
 * the wrong places.
 */
export function measureBlocks(
  view: EditorView,
  breaks: PageBreak[],
  metrics?: PageMetrics | null,
): BlockBox[] {
  // Lines cost a tree walk and a rect per text node, so they are measured only
  // where they can be used: everywhere when splitting is on, and otherwise only
  // for a block too tall to fit a page whole, which `canSplit` breaks up
  // whatever the setting says.
  const usable = metrics ? metrics.pageHeight - metrics.marginTop - metrics.marginBottom : 0;
  const splitParagraphs = metrics?.splitParagraphs === true;

  const rootRect = view.dom.getBoundingClientRect();
  // DocEditor scales the whole page with a CSS transform, which scales every
  // rect with it; offsetWidth is the unscaled width, so their ratio recovers
  // the zoom factor without the plugin having to know about it.
  const width = (view.dom as HTMLElement).offsetWidth;
  const scale = width > 0 && rootRect.width > 0 ? rootRect.width / width : 1;

  const boxes: BlockBox[] = [];
  let spacerIndex = 0;
  let spacerShift = 0;

  view.state.doc.forEach((node, offset) => {
    while (spacerIndex < breaks.length && breaks[spacerIndex].pos <= offset) {
      spacerShift += breaks[spacerIndex].height;
      spacerIndex += 1;
    }
    const dom = view.nodeDOM(offset);
    if (!dom || dom.nodeType !== 1) return;
    const rect = (dom as HTMLElement).getBoundingClientRect();

    // A spacer that split this block is part of its rendered height. Left in,
    // it would make the block look taller than it is and push every page count
    // after it wrong.
    let inner = 0;
    for (let i = spacerIndex; i < breaks.length && breaks[i].pos < offset + node.nodeSize; i++) {
      inner += breaks[i].height;
    }

    const top = (rect.top - rootRect.top) / scale - spacerShift;
    const height = rect.height / scale - inner;
    const box: BlockBox = { pos: offset, top, height };

    const wantsLines =
      splitParagraphs || (usable > 0 && height > usable + EPSILON);
    if (wantsLines && node.isTextblock) {
      const lines = measureLines(view, dom as HTMLElement, offset, rect.top, scale, breaks);
      if (lines.length > 1) box.lines = lines;
    }

    boxes.push(box);
  });

  return boxes;
}

/**
 * The line boxes of one text block, as offsets from the block's own top.
 *
 * Lines are read off the text nodes rather than off the block element, so this
 * plugin's own spacers — which are elements with no text in them — never show
 * up as lines of their own. Their heights are still subtracted, because a
 * spacer already inside this block pushes the lines below it down and the
 * result has to come back in natural coordinates like everything else.
 */
function measureLines(
  view: EditorView,
  blockDom: HTMLElement,
  blockPos: number,
  blockTopViewport: number,
  scale: number,
  breaks: PageBreak[],
): LineBox[] {
  const walker = document.createTreeWalker(blockDom, NodeFilter.SHOW_TEXT);
  const rows: { top: number; bottom: number; left: number }[] = [];

  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.nodeValue) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 && rect.height <= 0) continue;
      // Rects on the same line arrive once per text node (one per mark, per
      // link, per styled run), so merge anything sharing a top edge.
      const row = rows.find(r => Math.abs(r.top - rect.top) <= 1);
      if (row) {
        row.bottom = Math.max(row.bottom, rect.bottom);
        row.left = Math.min(row.left, rect.left);
      } else {
        rows.push({ top: rect.top, bottom: rect.bottom, left: rect.left });
      }
    }
  }

  rows.sort((a, b) => a.top - b.top);

  const lines: LineBox[] = [];
  for (const row of rows) {
    // A position on the line, asked for at its left edge: the first character.
    const found = view.posAtCoords({ left: row.left + 1, top: (row.top + row.bottom) / 2 });
    if (!found) return [];
    lines.push({
      pos: found.pos,
      offset: (row.top - blockTopViewport) / scale,
      height: (row.bottom - row.top) / scale,
    });
  }

  // Spacers this plugin already put *inside* this block pushed every line below
  // them down; take them back out so the offsets are natural, exactly as the
  // block tops are.
  const inside = breaks.filter(b => b.pos > blockPos);
  let index = 0;
  let shift = 0;
  for (const line of lines) {
    while (index < inside.length && inside[index].pos <= line.pos) {
      shift += inside[index].height;
      index += 1;
    }
    line.offset -= shift;
  }

  return lines;
}

/**
 * Tell the plugin what the page looks like. Called by the editor whenever page
 * setup changes; until it is, no spacers are inserted at all, so an editor
 * that never calls this behaves exactly as it did before pagination existed.
 */
export function setPageMetrics(editor: Editor, metrics: PageMetrics): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(paginationPluginKey, { metrics }));
}

export const PaginationExtension = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
    return { onPageCount: null };
  },

  addProseMirrorPlugins() {
    const { onPageCount } = this.options;

    return [
      new Plugin<PaginationState>({
        key: paginationPluginKey,

        state: {
          init: () => ({
            metrics: null,
            breaks: [],
            decorations: DecorationSet.empty,
          }),

          apply: (tr, current, _oldState, newState) => {
            const meta = tr.getMeta(paginationPluginKey) as
              | { metrics?: PageMetrics; breaks?: PageBreak[] }
              | undefined;

            let { metrics, breaks } = current;
            if (meta?.metrics) metrics = meta.metrics;
            if (meta?.breaks) breaks = meta.breaks;

            if (tr.docChanged && !meta?.breaks) {
              // Keep the existing spacers roughly in place until the next
              // measurement lands; dropping them for a frame makes the page
              // visibly jump on every keystroke.
              breaks = breaks
                .map(b => ({ ...b, pos: tr.mapping.map(b.pos, -1) }))
                .filter(b => b.pos >= 0 && b.pos <= newState.doc.content.size);
            }

            if (breaks === current.breaks && metrics === current.metrics && !tr.docChanged) {
              return current;
            }
            return { metrics, breaks, decorations: buildDecorations(newState.doc, breaks) };
          },
        },

        props: {
          decorations(state) {
            return paginationPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },

        view(view) {
          let frame = 0;
          let reportedPages = 0;

          const recalculate = () => {
            frame = 0;
            if (view.isDestroyed) return;
            // Never dispatch mid-composition: an IME candidate window is bound
            // to the selection, and the next composition event would re-run
            // this anyway.
            if (view.composing) return;
            const state = paginationPluginKey.getState(view.state);
            if (!state?.metrics) return;
            const blocks = measureBlocks(view, state.breaks, state.metrics);
            const { breaks, pages } = paginate(blocks, state.metrics);
            // Reported before the early return: a block too tall to break
            // changes how many pages the content covers without changing a
            // single spacer.
            if (pages !== reportedPages) {
              reportedPages = pages;
              onPageCount?.(pages);
            }
            if (sameBreaks(breaks, state.breaks)) return;
            view.dispatch(view.state.tr.setMeta(paginationPluginKey, { breaks }));
          };

          const schedule = () => {
            if (frame) return;
            // Measuring in a frame callback: layout has to have run for the
            // rects to mean anything, and it coalesces a burst of typing into
            // one pass.
            frame = requestAnimationFrame(recalculate);
          };

          // Images decoding and webfonts swapping in change block heights
          // without any transaction to hang a recalculation off.
          const observer =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
          observer?.observe(view.dom);

          schedule();

          return {
            update: () => schedule(),
            destroy: () => {
              if (frame) cancelAnimationFrame(frame);
              observer?.disconnect();
            },
          };
        },
      }),
    ];
  },
});
