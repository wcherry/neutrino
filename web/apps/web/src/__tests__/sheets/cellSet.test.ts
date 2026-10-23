import { describe, it, expect } from 'vitest';
import { HeaderCellSet, RectCellSet, isShaped, rangeCellSet } from '@/app/(apps)/sheets/editor/cellSet';
import { getRangeCells, numToAlpha } from '@/app/(apps)/sheets/editor/utils';
import { MAX_COLS, MAX_ROWS } from '@/app/(apps)/sheets/editor/constants';

describe('rangeCellSet', () => {
  it('lists the same cells, in the same order, as getRangeCells', () => {
    for (const [a, b] of [['B2', 'D5'], ['D5', 'B2'], ['A1', 'A1'], ['Z9', 'AB12']]) {
      expect([...rangeCellSet(a, b)]).toEqual([...getRangeCells(a, b)]);
      expect(rangeCellSet(a, b).size).toBe(getRangeCells(a, b).size);
    }
  });

  it('answers membership from the rectangle', () => {
    const cells = rangeCellSet('B2', 'D5');
    expect(cells.has('B2')).toBe(true);
    expect(cells.has('D5')).toBe(true);
    expect(cells.has('C3')).toBe(true);
    expect(cells.has('A2')).toBe(false);
    expect(cells.has('E5')).toBe(false);
    expect(cells.has('B6')).toBe(false);
    expect(cells.has('not a cell')).toBe(false);
  });

  it('does not list a whole-row rectangle to answer about it', () => {
    const rows = new RectCellSet(1, MAX_COLS, 3, 19);
    expect(rows.size).toBe(MAX_COLS * 17);
    expect(rows.has(`${numToAlpha(MAX_COLS)}19`)).toBe(true);
    expect(rows.bounds()).toEqual({ minCol: 1, maxCol: MAX_COLS, minRow: 3, maxRow: 19 });
    expect(isShaped(rows)).toBe(true);
    expect(isShaped(new Set(['A1']))).toBe(false);
  });
});

describe('HeaderCellSet', () => {
  it('holds exactly the cells of the selected rows', () => {
    const rows = new HeaderCellSet('row', [1, 3]);
    expect(rows.size).toBe(2 * MAX_COLS);
    expect(rows.has('A2')).toBe(true);
    expect(rows.has('C4')).toBe(true);
    expect(rows.has('A3')).toBe(false);
    expect(rows.bounds()).toEqual({ minCol: 1, maxCol: MAX_COLS, minRow: 2, maxRow: 4 });
    const first = rows[Symbol.iterator]();
    expect([first.next().value, first.next().value]).toEqual(['A2', 'B2']);
  });

  it('holds exactly the cells of the selected columns', () => {
    const cols = new HeaderCellSet('col', [0, 2]);
    expect(cols.size).toBe(2 * MAX_ROWS);
    expect(cols.has('A100')).toBe(true);
    expect(cols.has('C1')).toBe(true);
    expect(cols.has('B1')).toBe(false);
    expect(cols.has(`A${MAX_ROWS + 1}`)).toBe(false);
  });
});
