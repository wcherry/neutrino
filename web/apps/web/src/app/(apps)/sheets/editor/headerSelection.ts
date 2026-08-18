// Pure (no React) model for selecting one or more row / column headers.
//
// A header selection is always along a single axis — clicking a row header
// while columns are selected starts a fresh row selection, exactly as it does
// in Excel and Google Sheets.
//
// Three gestures produce a selection, and they compose:
//   plain click          → replaces the selection with the clicked header
//   Cmd/Ctrl + click     → toggles the clicked header in or out of it
//   Shift + click / drag → extends from the anchor to the clicked header
//
// `before` is what makes the third gesture repeatable: it holds the indices
// that were selected *before* the run currently being extended began, so
// dragging back and forth re-computes the run from `anchor` without eating the
// headers a previous Cmd+click added.

import { MAX_COLS, MAX_ROWS } from './constants';
import { numToAlpha } from './utils';

export type HeaderAxis = 'col' | 'row';

export type HeaderSelection = {
    axis: HeaderAxis;
    /** 0-based indices, ascending and de-duplicated. Never empty. */
    indices: number[];
    /** 0-based index that a shift-click or drag extends from. */
    anchor: number;
    /** Indices preserved across an extension (see the note above). */
    before: number[];
};

export type HeaderClickModifiers = {
    /** Cmd (macOS) or Ctrl — toggle a single header in or out. */
    toggle?: boolean;
    /** Shift — extend from the anchor to the clicked header. */
    extend?: boolean;
};

function sortedUnique(indices: Iterable<number>): number[] {
    return Array.from(new Set(indices)).sort((a, b) => a - b);
}

function inclusiveRange(a: number, b: number): number[] {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
}

/** The selection produced by clicking header `index` with `mods` held. */
export function selectHeader(
    current: HeaderSelection | null,
    axis: HeaderAxis,
    index: number,
    mods: HeaderClickModifiers = {},
): HeaderSelection {
    // A click on the other axis always starts over — a selection spanning both
    // rows and columns has no meaning.
    if (!current || current.axis !== axis) {
        return { axis, indices: [index], anchor: index, before: [] };
    }

    if (mods.extend) return extendHeaderSelection(current, index);

    if (mods.toggle) {
        if (current.indices.includes(index)) {
            const remaining = current.indices.filter(i => i !== index);
            // Deselecting the last header would leave nothing selected; keep it.
            if (remaining.length === 0) return current;
            // The anchor must stay on a header that is still selected, or a
            // later Shift+click would extend from — and so re-select — the one
            // just dismissed.
            const anchor = remaining.includes(current.anchor)
                ? current.anchor
                : remaining[remaining.length - 1];
            return { axis, indices: remaining, anchor, before: remaining };
        }
        const indices = sortedUnique([...current.indices, index]);
        return { axis, indices, anchor: index, before: current.indices };
    }

    return { axis, indices: [index], anchor: index, before: [] };
}

/** Extends the active run to `index` — used by both Shift+click and dragging. */
export function extendHeaderSelection(current: HeaderSelection, index: number): HeaderSelection {
    return {
        axis: current.axis,
        indices: sortedUnique([...current.before, ...inclusiveRange(current.anchor, index)]),
        anchor: current.anchor,
        before: current.before,
    };
}

export type HeaderRun = { start: number; end: number };

/** Splits ascending indices into contiguous runs: [2,3,4,7] → 2–4 and 7–7. */
export function headerRuns(indices: number[]): HeaderRun[] {
    const runs: HeaderRun[] = [];
    for (const i of indices) {
        const last = runs[runs.length - 1];
        if (last && i === last.end + 1) last.end = i;
        else runs.push({ start: i, end: i });
    }
    return runs;
}

function headerName(axis: HeaderAxis, index: number): string {
    return axis === 'col' ? numToAlpha(index + 1) : `${index + 1}`;
}

/** Name-box label for a header selection: `C`, `C:E`, `C:E, G`, `3:7`. */
export function headerSelectionLabel(selection: HeaderSelection): string {
    return headerRuns(selection.indices)
        .map(({ start, end }) => start === end
            ? headerName(selection.axis, start)
            : `${headerName(selection.axis, start)}:${headerName(selection.axis, end)}`)
        .join(', ');
}

/**
 * The bounding range of a header selection, as anchor/active cell ids. Used for
 * the anchor/active pair the rest of the editor navigates by; the exact cell set
 * (which for a non-contiguous selection is smaller than this box) comes from
 * `headerSelectionCells`.
 */
export function headerSelectionCellBounds(selection: HeaderSelection): { anchor: string; active: string } {
    const first = selection.indices[0];
    const last = selection.indices[selection.indices.length - 1];
    if (selection.axis === 'col') {
        return { anchor: `${numToAlpha(first + 1)}1`, active: `${numToAlpha(last + 1)}${MAX_ROWS}` };
    }
    return { anchor: `A${first + 1}`, active: `${numToAlpha(MAX_COLS)}${last + 1}` };
}

/** Every cell id covered by a header selection. */
export function headerSelectionCells(selection: HeaderSelection): Set<string> {
    const cells = new Set<string>();
    if (selection.axis === 'col') {
        for (const c of selection.indices) {
            const letter = numToAlpha(c + 1);
            for (let r = 1; r <= MAX_ROWS; r++) cells.add(`${letter}${r}`);
        }
    } else {
        for (const r of selection.indices) {
            const rowN = r + 1;
            for (let c = 1; c <= MAX_COLS; c++) cells.add(`${numToAlpha(c)}${rowN}`);
        }
    }
    return cells;
}
