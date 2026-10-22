// The set of selected cells, without listing them.
//
// A selection can be enormous: a row header is MAX_COLS cells and a column header MAX_ROWS, so
// selecting a run of seventeen rows used to build a Set of more than a million cell ids — twice,
// once for the header selection and once for the anchor/active rectangle behind it — seconds of
// work on the click (the perf suite's D8). Almost everything that reads the selection only asks
// whether a cell is in it, or where its edges are; these answer both from the shape. Iterating
// still lists every cell, so an operation over a huge selection costs what it did, but merely
// selecting no longer does.

import { MAX_COLS, MAX_ROWS } from './constants';
import { numToAlpha, parseCellId } from './utils';

/** What the editor needs from a selection: `Set<string>` satisfies it too. */
export interface CellSet extends Iterable<string> {
    readonly size: number;
    has(id: string): boolean;
    forEach(fn: (id: string) => void): void;
}

/** The 1-based bounding rectangle of a shaped selection, when it knows one without iterating. */
export type CellBounds = { minCol: number; maxCol: number; minRow: number; maxRow: number };

/** A shaped selection: anything here that is not a plain Set. */
export interface ShapedCellSet extends CellSet {
    bounds(): CellBounds;
}

export function isShaped(cells: CellSet): cells is ShapedCellSet {
    return typeof (cells as Partial<ShapedCellSet>).bounds === 'function';
}

/** Every cell from column `c1` to `c2` and row `r1` to `r2`, inclusive and 1-based, column by column. */
export class RectCellSet implements ShapedCellSet {
    constructor(
        private readonly c1: number,
        private readonly c2: number,
        private readonly r1: number,
        private readonly r2: number,
    ) {}

    get size(): number {
        return (this.c2 - this.c1 + 1) * (this.r2 - this.r1 + 1);
    }

    has(id: string): boolean {
        const p = parseCellId(id);
        return !!p && p.col >= this.c1 && p.col <= this.c2 && p.row >= this.r1 && p.row <= this.r2;
    }

    bounds(): CellBounds {
        return { minCol: this.c1, maxCol: this.c2, minRow: this.r1, maxRow: this.r2 };
    }

    *[Symbol.iterator](): Iterator<string> {
        for (let c = this.c1; c <= this.c2; c++) {
            const letter = numToAlpha(c);
            for (let r = this.r1; r <= this.r2; r++) yield `${letter}${r}`;
        }
    }

    forEach(fn: (id: string) => void): void {
        for (const id of this) fn(id);
    }
}

/** Whole rows or whole columns, by 0-based index (ascending), in the order headerSelectionCells listed them. */
export class HeaderCellSet implements ShapedCellSet {
    private readonly members: Set<number>;

    constructor(private readonly axis: 'col' | 'row', private readonly indices: number[]) {
        this.members = new Set(indices);
    }

    get size(): number {
        return this.indices.length * (this.axis === 'col' ? MAX_ROWS : MAX_COLS);
    }

    has(id: string): boolean {
        const p = parseCellId(id);
        if (!p || p.col < 1 || p.row < 1 || p.col > MAX_COLS || p.row > MAX_ROWS) return false;
        return this.members.has((this.axis === 'col' ? p.col : p.row) - 1);
    }

    bounds(): CellBounds {
        const first = this.indices[0] + 1;
        const last = this.indices[this.indices.length - 1] + 1;
        return this.axis === 'col'
            ? { minCol: first, maxCol: last, minRow: 1, maxRow: MAX_ROWS }
            : { minCol: 1, maxCol: MAX_COLS, minRow: first, maxRow: last };
    }

    *[Symbol.iterator](): Iterator<string> {
        if (this.axis === 'col') {
            for (const c of this.indices) {
                const letter = numToAlpha(c + 1);
                for (let r = 1; r <= MAX_ROWS; r++) yield `${letter}${r}`;
            }
        } else {
            for (const r of this.indices) {
                const rowN = r + 1;
                for (let c = 1; c <= MAX_COLS; c++) yield `${numToAlpha(c)}${rowN}`;
            }
        }
    }

    forEach(fn: (id: string) => void): void {
        for (const id of this) fn(id);
    }
}

/** The rectangle between two cell ids, as `getRangeCells` would list it. */
export function rangeCellSet(anchor: string, active: string): CellSet {
    const a = parseCellId(anchor);
    const b = parseCellId(active);
    if (!a || !b) return new Set([anchor]);
    return new RectCellSet(
        Math.min(a.col, b.col), Math.max(a.col, b.col),
        Math.min(a.row, b.row), Math.max(a.row, b.row),
    );
}
