/**
 * Sheets' preview signature: page one only, and the same whether it was read
 * from a stored workbook or from the editor's own serialisation.
 */
import { describe, it, expect } from 'vitest';
import { sheetFirstPageSignature } from '@/app/(apps)/sheets/editor/sheetPreview';
import type { SheetData } from '@/app/(apps)/sheets/editor/types';

const base: SheetData = {
  name: 'Budget',
  cells: {
    A1: { id: 'A1', raw: 'Item', value: 'Item', cellStyle: { fontWeight: 'bold' } },
    B2: { id: 'B2', raw: '=1+1', value: '2' },
  },
};

describe('sheetFirstPageSignature', () => {
  it('ignores cells below and to the right of page one', () => {
    const edited: SheetData = {
      ...base,
      cells: { ...base.cells, A500: { id: 'A500', raw: 'x', value: 'x' }, Z1: { id: 'Z1', raw: 'y' } },
    };
    expect(sheetFirstPageSignature(edited)).toBe(sheetFirstPageSignature(base));
  });

  it('changes when a cell on page one changes', () => {
    const edited: SheetData = { ...base, cells: { ...base.cells, C3: { id: 'C3', raw: 'new', value: 'new' } } };
    expect(sheetFirstPageSignature(edited)).not.toBe(sheetFirstPageSignature(base));
  });

  it('changes when a column on page one is resized', () => {
    expect(sheetFirstPageSignature({ ...base, colWidths: { '1': 180 } }))
      .not.toBe(sheetFirstPageSignature(base));
  });

  it('does not care which order the cells were written in, or about undefined fields', () => {
    const reordered: SheetData = {
      ...base,
      cells: {
        B2: { id: 'B2', raw: '=1+1', value: '2', cellStyle: undefined, colSpan: undefined },
        A1: base.cells.A1,
      },
    };
    expect(sheetFirstPageSignature(reordered)).toBe(sheetFirstPageSignature(base));
  });
});
