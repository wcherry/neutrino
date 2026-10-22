import type { Transaction } from '@tiptap/pm/state';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import type { Node as PmNode } from '@tiptap/pm/model';
import { type Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Decorations kept up to date per paragraph instead of rebuilt per keystroke.
 *
 * The spell- and grammar-check plugins used to walk the whole document on every transaction. In a
 * 1 000-paragraph document that was most of each keystroke's cost (the perf suite's C2: ~100 ms of
 * plugin work per character at 4× CPU, then ProseMirror diffing two whole-document decoration
 * sets). A keystroke changes one paragraph; this maps the existing set past the change — positions
 * shift, nothing is recomputed — and rebuilds only the textblocks the change touched.
 */

/** What a transaction changed: one range of `tr.doc`, and a mapping that moves everything else. */
export interface TransactionDiff {
  from: number;
  to: number;
  map: Mapping;
}

const diffs = new WeakMap<Transaction, TransactionDiff | null>();

/**
 * What `tr` changed, found by comparing the documents rather than read off its steps; null when
 * they are equal.
 *
 * Usually the same thing. Not for collaboration: y-prosemirror applies an undo or a remote edit as
 * one step replacing the whole document (keeping the unchanged nodes), so its step map says every
 * position changed, and anything mapped through it — decorations, page spacers — is thrown away and
 * rebuilt for the whole document. Comparing finds the unchanged nodes by identity, so it costs no
 * more than the edit. Cached per transaction: several plugins ask.
 */
export function transactionDiff(tr: Transaction): TransactionDiff | null {
  const cached = diffs.get(tr);
  if (cached !== undefined) return cached;
  let diff: TransactionDiff | null = null;
  const before = tr.before.content;
  const after = tr.doc.content;
  const start = before.findDiffStart(after);
  if (start !== null) {
    let { a: endA, b: endB } = before.findDiffEnd(after)!;
    // Repeated text lets the two ends cross; widen both until they start where the change does.
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    diff = { from: start, to: endB, map: new Mapping([new StepMap([start, endA - start, endB - start])]) };
  }
  diffs.set(tr, diff);
  return diff;
}

/** Every textblock overlapping one of `ranges`, once each, with its position. */
export function touchedTextblocks(doc: PmNode, ranges: { from: number; to: number }[]): { node: PmNode; pos: number }[] {
  const seen = new Set<number>();
  const out: { node: PmNode; pos: number }[] = [];
  const size = doc.content.size;
  for (const r of ranges) {
    const from = Math.max(0, Math.min(r.from, size));
    const to = Math.max(from, Math.min(r.to, size));
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (!seen.has(pos)) {
        seen.add(pos);
        out.push({ node, pos });
      }
      return false;
    });
    // A deletion that joined two paragraphs leaves an empty range between them; the paragraph the
    // range now sits in is the one to re-check.
    const $from = doc.resolve(from);
    for (let d = $from.depth; d > 0; d -= 1) {
      const node = $from.node(d);
      if (node.isTextblock) {
        const pos = $from.before(d);
        if (!seen.has(pos)) {
          seen.add(pos);
          out.push({ node, pos });
        }
        break;
      }
    }
  }
  return out;
}

/**
 * The part of the document decorations are kept for: the blocks on screen and a screen either side
 * (`observeDecorationWindow`). `null` is the whole document.
 *
 * A misspelling is a span, and a long document of them is thousands of extra elements in the
 * editable root — which Chrome walks from the top on every caret move to work out the caret's text
 * offset, twice a keystroke. Nobody sees a squiggle forty pages away; it is drawn when scrolled to.
 */
export type DecorationWindow = { from: number; to: number } | null;

/** Decorations for every textblock in `doc` (or in `window`), built one block at a time with `build`. */
export function buildAll(
  doc: PmNode,
  build: (block: PmNode, pos: number) => Decoration[],
  window: DecorationWindow = null,
): DecorationSet {
  const all: Decoration[] = [];
  const visit = (node: PmNode, pos: number) => {
    if (!node.isTextblock) return true;
    for (const d of build(node, pos)) all.push(d);
    return false;
  };
  if (window) doc.nodesBetween(window.from, window.to, visit);
  else doc.descendants(visit);
  return DecorationSet.create(doc, all);
}

/** `window` carried through `tr`'s edits. */
export function mapWindow(window: DecorationWindow, tr: Transaction): DecorationWindow {
  const diff = transactionDiff(tr);
  if (!window || !diff) return window;
  return { from: diff.map.map(window.from, -1), to: diff.map.map(window.to, 1) };
}

/** `build`, restricted to blocks overlapping `window`. */
export function withinWindow(
  window: DecorationWindow,
  build: (block: PmNode, pos: number) => Decoration[],
): (block: PmNode, pos: number) => Decoration[] {
  if (!window) return build;
  return (block, pos) => (pos + block.nodeSize > window.from && pos < window.to ? build(block, pos) : []);
}

/** `set` with its window moved from `prev` to `next`: what left it dropped, what entered it built. */
export function moveWindow(
  set: DecorationSet,
  doc: PmNode,
  prev: DecorationWindow,
  next: DecorationWindow,
  build: (block: PmNode, pos: number) => Decoration[],
): DecorationSet {
  let out = set;
  if (next) {
    out = out.remove(out.find(0, next.from)).remove(out.find(next.to, doc.content.size));
  }
  const fresh: Decoration[] = [];
  const visit = (node: PmNode, pos: number) => {
    if (!node.isTextblock) return true;
    const wasIn = !prev || (pos + node.nodeSize > prev.from && pos < prev.to);
    if (!wasIn) for (const d of build(node, pos)) fresh.push(d);
    return false;
  };
  if (next) doc.nodesBetween(next.from, next.to, visit);
  else doc.descendants(visit);
  return fresh.length ? out.add(doc, fresh) : out;
}

/** Below this many top-level blocks a document is decorated whole; windowing would only add churn. */
const WINDOW_MIN_BLOCKS = 200;

/** Marks a transaction that only moves a decoration window, so listeners can ignore it. */
export const DECORATION_WINDOW_META = 'decorationWindow';

/**
 * The top-level blocks within a screen of the viewport, found by binary search on their rects, as a
 * document range; null for a short document.
 */
export function visibleWindow(view: EditorView): DecorationWindow {
  const doc = view.state.doc;
  if (doc.childCount < WINDOW_MIN_BLOCKS) return null;
  const offsets: number[] = [];
  doc.forEach((_node, offset) => offsets.push(offset));
  const rect = (i: number) => {
    const dom = view.nodeDOM(offsets[i]);
    return dom && dom.nodeType === 1 ? (dom as HTMLElement).getBoundingClientRect() : null;
  };
  const screen = window.innerHeight;
  const top = -screen;
  const bottom = 2 * screen;
  // The first block whose bottom is below `top`, and the last whose top is above `bottom`.
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = rect(mid);
    if (!r) return null;
    if (r.bottom < top) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const r = rect(mid);
    if (!r) return null;
    if (r.top > bottom) hi = mid - 1;
    else lo = mid;
  }
  return { from: offsets[first], to: offsets[lo] + doc.child(lo).nodeSize };
}

/**
 * Calls `report` with the visible window whenever scrolling or resizing may have moved it — and
 * after `update()`, for an edit — at most every 100 ms and always after the frame has painted.
 */
export function observeDecorationWindow(view: EditorView, report: (window: DecorationWindow) => void): {
  update: () => void;
  destroy: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    if (!view.isDestroyed) report(visibleWindow(view));
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(run, 100);
  };
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  schedule();
  return {
    update: schedule,
    destroy: () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    },
  };
}

/**
 * The window a document is decorated in before the view has reported one: none for a short
 * document, the opening blocks for a long one (it opens at the top).
 */
export function settleWindow(doc: PmNode, window: DecorationWindow): DecorationWindow {
  if (doc.childCount < WINDOW_MIN_BLOCKS) return null;
  if (window) return window;
  let to = 0;
  doc.forEach((node, offset, index) => {
    if (index < WINDOW_MIN_BLOCKS) to = offset + node.nodeSize;
  });
  return { from: 0, to };
}

/** Whether two windows cover the same blocks. */
export function sameWindow(a: DecorationWindow, b: DecorationWindow): boolean {
  return a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
}

/** `set` brought up to date with `tr`: mapped, then rebuilt for the textblocks `tr` touched. */
export function updateForTransaction(
  set: DecorationSet,
  tr: Transaction,
  build: (block: PmNode, pos: number) => Decoration[],
): DecorationSet {
  const diff = transactionDiff(tr);
  if (!diff) return set;
  let next = set.map(diff.map, tr.doc);
  for (const { node, pos } of touchedTextblocks(tr.doc, [diff])) {
    const end = pos + node.nodeSize;
    next = next.remove(next.find(pos, end));
    const fresh = build(node, pos);
    if (fresh.length) next = next.add(tr.doc, fresh);
  }
  return next;
}

/** Each text node of a textblock with its absolute position — what a per-block check walks. */
export function forEachText(block: PmNode, blockPos: number, fn: (text: string, pos: number) => void): void {
  block.descendants((child, offset) => {
    if (child.isText && child.text) fn(child.text, blockPos + 1 + offset);
  });
}
