'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Render only the rows of a long list or grid that are on screen.
 *
 * `FileGrid` used to render every item it was given, and My Drive pages at 200
 * and never trims, so a folder scrolled to the bottom held every row it had
 * ever loaded. The perf suite measured what that costs: 1 000 rows took 8.4×
 * as long to render as 25, scrolled at 38 fps with a third of frames dropped,
 * and a view switch blocked for over a second (B1–B5,
 * agent_docs/ui-performance-roadmap.md P1).
 *
 * The mechanism is the plain one, in-house rather than a dependency: rows are
 * a fixed height within a layout, so the visible range is arithmetic. The
 * rows above and below it are not rendered at all; the container's own
 * padding stands in for their height, so the scrollbar, the scroll position
 * and anything laid out after the container behave as if they were there.
 *
 * Three things it deliberately does not assume:
 *
 *  - **The row height.** It is measured from the first rendered item, not
 *    configured, so a density setting (or a card that grows a line) changes
 *    the arithmetic by itself — a hard-coded height is how a virtualised list
 *    drifts out of step with its CSS.
 *  - **The scroller.** The detailed list scrolls itself and the grids scroll
 *    the app shell's main area; the nearest scrolling ancestor is found at
 *    runtime rather than passed in.
 *  - **That layout exists.** Where every size reads 0 — jsdom, or a container
 *    not yet in the document — it renders everything, which is what a list
 *    that cannot be measured has to do to stay correct.
 */

export interface WindowRange {
  /** Index of the first item to render. */
  start: number;
  /** One past the last item to render. */
  end: number;
  /** Height standing in for the rows before `start`, in px. */
  padTop: number;
  /** Height standing in for the rows after `end`, in px. */
  padBottom: number;
}

export interface WindowInput {
  count: number;
  columns: number;
  /** One row's height plus the gap below it. */
  stride: number;
  /** How far the scroller's top edge is below the container's top edge, in px (≤ 0 when the container starts below it). */
  scrolledInto: number;
  /** The scroller's visible height. */
  viewport: number;
  /** Rows rendered beyond each edge of the viewport. */
  overscanRows: number;
}

/** The rows a viewport needs, as item indices and the padding that replaces the rest. Pure, so it is tested alone. */
export function computeWindow({ count, columns, stride, scrolledInto, viewport, overscanRows }: WindowInput): WindowRange {
  const all = { start: 0, end: count, padTop: 0, padBottom: 0 };
  if (count === 0 || columns < 1 || stride <= 0 || viewport <= 0) return all;

  const totalRows = Math.ceil(count / columns);
  const top = Math.max(0, scrolledInto);
  const bottom = Math.max(0, scrolledInto + viewport);
  const firstRow = Math.min(totalRows, Math.max(0, Math.floor(top / stride) - overscanRows));
  const lastRow = Math.min(totalRows, Math.max(firstRow, Math.ceil(bottom / stride) + overscanRows));

  return {
    start: firstRow * columns,
    end: Math.min(count, lastRow * columns),
    padTop: firstRow * stride,
    padBottom: (totalRows - lastRow) * stride,
  };
}

/** How many `minWidth` columns `repeat(auto-fill, minmax(minWidth, 1fr))` fits into `width`. */
export function autoFillColumns(width: number, minWidth: number, gap: number): number {
  if (width <= 0 || minWidth <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
  }
  return null;
}

function sameRange(a: WindowRange, b: WindowRange): boolean {
  return a.start === b.start && a.end === b.end && a.padTop === b.padTop && a.padBottom === b.padBottom;
}

export interface UseWindowedItemsOptions {
  count: number;
  /** The `minmax()` minimum of an auto-fill grid; omit for a single-column list. */
  minColumnWidth?: number;
  /** Below this many items everything renders — windowing a short list buys nothing. */
  threshold?: number;
  overscanRows?: number;
  /** Changes when the layout does (view mode), so the row height is re-measured. */
  layoutKey: string;
}

/** Items rendered before the first measurement, so a long list's first paint is not every row. */
const FIRST_PAINT_ITEMS = 60;

export function useWindowedItems({
  count,
  minColumnWidth,
  threshold = 120,
  overscanRows = 4,
  layoutKey,
}: UseWindowedItemsOptions): { ref: (el: HTMLElement | null) => void; range: WindowRange } {
  const enabled = count > threshold;
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [range, setRange] = useState<WindowRange>(() =>
    enabled ? { start: 0, end: Math.min(count, FIRST_PAINT_ITEMS), padTop: 0, padBottom: 0 } : { start: 0, end: count, padTop: 0, padBottom: 0 },
  );
  const rangeRef = useRef(range);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  // Whether any item is on screen. A dependency of the measuring effect, so a
  // list that started empty is measured again once its first slice paints,
  // instead of waiting for a scroll or resize.
  const rendering = range.end > range.start;

  useLayoutEffect(() => {
    const full = { start: 0, end: count, padTop: 0, padBottom: 0 };
    const commit = (next: WindowRange) => {
      if (sameRange(rangeRef.current, next)) return;
      rangeRef.current = next;
      setRange(next);
    };
    if (!enabled || !el) {
      commit(full);
      return;
    }

    const scroller = scrollParent(el);
    let frame = 0;

    const measure = () => {
      frame = 0;
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) {
        // Items arrived since the last render (a listing that loaded after
        // mount): paint a first slice and measure that, rather than falling
        // back to every row — which is the cost this exists to avoid.
        commit({ start: 0, end: Math.min(count, FIRST_PAINT_ITEMS), padTop: 0, padBottom: 0 });
        return;
      }
      const itemHeight = first.getBoundingClientRect().height;
      const style = getComputedStyle(el);
      const rowGap = parseFloat(style.rowGap) || 0;
      const columnGap = parseFloat(style.columnGap) || 0;
      const innerWidth = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const viewport = scroller ? scroller.clientHeight : window.innerHeight;
      if (itemHeight <= 0 || innerWidth <= 0 || viewport <= 0) {
        commit(full);
        return;
      }
      const columns = minColumnWidth ? autoFillColumns(innerWidth, minColumnWidth, columnGap) : 1;
      // Row 0 sits at the container's top edge: the only top padding it has is
      // `padTop`, which stands in for the rows above the window.
      const elTop = el.getBoundingClientRect().top;
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      commit(computeWindow({
        count,
        columns,
        stride: itemHeight + rowGap,
        scrolledInto: scrollerTop - elTop,
        viewport,
        overscanRows,
      }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', schedule, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(el);
    if (scroller) resize?.observe(scroller);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      target.removeEventListener('scroll', schedule);
      resize?.disconnect();
    };
  }, [el, count, enabled, minColumnWidth, overscanRows, layoutKey, rendering]);

  return { ref, range };
}
