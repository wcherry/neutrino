/**
 * `writeXlsx` and `readXlsx` are two halves of one mapping, and this is what
 * says so. A construct written with no counterpart in the reader is a construct
 * the next save deletes.
 *
 * The second thing it pins down is that the workbook is a *real* one: SheetJS
 * reads the output and sees the same values, formulas and merges. That is the
 * property the `neutrino/model.json` part existed to work around — a spreadsheet
 * whose OOXML nobody else could read — so an assertion by a foreign parser is
 * worth more here than any number of our own.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

import { writeXlsx } from '@/lib/ooxml/xlsx/write';
import { readXlsx } from '@/lib/ooxml/xlsx/read';
import type { SheetFile, SheetData } from '@/app/(apps)/sheets/editor/types';

const cell = (id: string, raw: string, extra: Record<string, unknown> = {}) =>
  [id, { id, raw, value: raw, ...extra }] as const;

function file(...sheets: Partial<SheetData>[]): SheetFile {
  return { sheets: sheets.map((s, i) => ({ name: `Sheet${i + 1}`, cells: {}, ...s })) };
}

/** Write, read back, and hand over the sheet at `index`. */
async function roundTrip(input: SheetFile, index = 0): Promise<SheetData> {
  const bytes = await writeXlsx(input);
  return (await readXlsx(bytes)).sheets[index];
}

describe('writeXlsx → readXlsx', () => {
  it('carries values, numbers and formulas', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([
        cell('A1', 'Widget'),
        cell('B1', '42'),
        ['C1', { id: 'C1', raw: '=SUM(B1:B1)', value: '42' }],
      ]),
    }));

    expect(out.cells.A1).toMatchObject({ raw: 'Widget', value: 'Widget' });
    expect(out.cells.B1).toMatchObject({ raw: '42', value: '42' });
    expect(out.cells.C1).toMatchObject({ raw: '=SUM(B1:B1)', value: '42' });
  });

  /**
   * `Number()` accepts far more than a spreadsheet should store as a number.
   * The one that bites is leading zeros: a column of zip codes stored as
   * numbers comes back having lost its first digit.
   */
  it('keeps a number-shaped code as the text it is', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([
        cell('A1', '02134'),
        cell('A2', '1e5'),
        cell('A3', '-4.25'),
        cell('A4', '0'),
      ]),
    }));

    expect(out.cells.A1.raw).toBe('02134');
    expect(out.cells.A2.raw).toBe('1e5');
    expect(out.cells.A3.raw).toBe('-4.25');
    expect(out.cells.A4.raw).toBe('0');
  });

  it('keeps text that would break the XML', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([cell('A1', 'a < b & "c" > d'), cell('A2', '  spaced  ')]),
    }));

    expect(out.cells.A1.raw).toBe('a < b & "c" > d');
    expect(out.cells.A2.raw).toBe('  spaced  ');
  });

  it('carries every part of a cell style', async () => {
    const style = {
      fontFamily: 'Georgia', fontSize: '14pt', fontWeight: 'bold', fontStyle: 'italic',
      textDecoration: 'line-through', color: '#112233', backgroundColor: '#ffee00',
      textAlign: 'center', verticalAlign: 'bottom',
      borderTop: 'thin', borderBottom: 'thick', borderLeft: 'medium',
    } as const;
    const out = await roundTrip(file({ cells: Object.fromEntries([cell('A1', 'x', { cellStyle: style })]) }));

    expect(out.cells.A1.cellStyle).toMatchObject(style);
  });

  it('carries the structured number formats as themselves', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([
        cell('A1', '0.15', { cellStyle: { numberFormat: 'percent', decimalPlaces: 1 } }),
        cell('A2', '9.5', { cellStyle: { numberFormat: 'currency', decimalPlaces: 2 } }),
        cell('A3', '1000', { cellStyle: { numberFormat: 'number' } }),
        cell('A4', '45926', { cellStyle: { numberFormat: 'date' } }),
      ]),
    }));

    expect(out.cells.A1.cellStyle).toMatchObject({ numberFormat: 'percent', decimalPlaces: 1 });
    expect(out.cells.A2.cellStyle).toMatchObject({ numberFormat: 'currency', decimalPlaces: 2 });
    expect(out.cells.A3.cellStyle).toMatchObject({ numberFormat: 'number' });
    expect(out.cells.A4.cellStyle).toMatchObject({ numberFormat: 'date' });
    // The value stays the number it is; the format is what renders it.
    expect(out.cells.A1.raw).toBe('0.15');
  });

  it('carries a custom format code verbatim', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([cell('A1', '0.5', { cellStyle: { customFormat: '0.000"kg"' } })]),
    }));

    expect(out.cells.A1.cellStyle).toMatchObject({ customFormat: '0.000"kg"' });
  });

  it('carries column widths, row heights and the tab colour', async () => {
    const out = await roundTrip(file({
      color: '#ff8800',
      cells: Object.fromEntries([cell('A1', 'x')]),
      colWidths: { '0': 180, '2': 60 },
      rowHeights: { '0': 40 },
    }));

    expect(out.color).toBe('#ff8800');
    expect(out.colWidths).toMatchObject({ '0': 180, '2': 60 });
    expect(out.rowHeights).toMatchObject({ '0': 40 });
  });

  it('carries a merge as the span and the cells it covers', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([cell('A1', 'wide', { colSpan: 2, rowSpan: 2 })]),
    }));

    expect(out.cells.A1).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(out.cells.B1).toMatchObject({ mergeAnchor: 'A1' });
    expect(out.cells.A2).toMatchObject({ mergeAnchor: 'A1' });
    expect(out.cells.B2).toMatchObject({ mergeAnchor: 'A1' });
  });

  it('keeps more than one sheet, in order, with their names repaired', async () => {
    const out = await readXlsx(await writeXlsx(file(
      { name: 'First', cells: Object.fromEntries([cell('A1', '1')]) },
      { name: 'Q1/Q2 [draft]', cells: Object.fromEntries([cell('A1', '2')]) },
    )));

    expect(out.sheets.map((s) => s.name)).toEqual(['First', 'Q1 Q2  draft']);
    expect(out.sheets[1].cells.A1.raw).toBe('2');
  });

  // ── Conditional formats ────────────────────────────────────────────────────

  it('carries the rules OOXML has an operator for', async () => {
    const rules = [
      { id: 'r1', range: 'A1:A9', rule: { kind: 'singleColor', condition: 'greaterThan', value: '5', format: { backgroundColor: '#ffdddd', fontWeight: 'bold' } } },
      { id: 'r2', range: 'B1:B9', rule: { kind: 'singleColor', condition: 'between', value: '1', value2: '9', format: { color: '#003300' } } },
      { id: 'r3', range: 'C1:C9', rule: { kind: 'singleColor', condition: 'containsText', value: 'urgent', format: { fontStyle: 'italic' } } },
      { id: 'r4', range: 'D1:D9', rule: { kind: 'singleColor', condition: 'isEmpty', format: { backgroundColor: '#eeeeee' } } },
      { id: 'r5', range: 'E1:E9', rule: { kind: 'colorScale', minColor: '#ff0000', midColor: '#ffff00', maxColor: '#00ff00' } },
      { id: 'r6', range: 'F1:F9', rule: { kind: 'dataBar', color: '#3366cc', gradient: true } },
      { id: 'r7', range: 'G1:G9', rule: { kind: 'iconSet', iconSet: 'arrows' } },
      { id: 'r8', range: 'H1:H9', rule: { kind: 'topBottom', direction: 'bottom', type: 'percent', value: 15, format: { color: '#111111' } } },
      { id: 'r9', range: 'I1:I9', rule: { kind: 'average', direction: 'below', format: { color: '#222222' } } },
      { id: 'r10', range: 'J1:J9', rule: { kind: 'formula', formula: '=A1>B1', format: { backgroundColor: '#ccddff' } } },
      { id: 'r11', range: 'K1:K9', rule: { kind: 'duplicates', format: { color: '#333333' } }, stopIfTrue: true },
    ];
    const out = await roundTrip(file({
      cells: Object.fromEntries([cell('A1', '1')]),
      conditionalFormats: rules as never,
    }));

    const got = out.conditionalFormats ?? [];
    expect(got).toHaveLength(rules.length);
    expect(got.map((r) => r.range)).toEqual(rules.map((r) => r.range));
    expect(got[0].rule).toMatchObject({ kind: 'singleColor', condition: 'greaterThan', value: '5' });
    expect(got[0].rule).toMatchObject({ format: { backgroundColor: '#ffdddd', fontWeight: 'bold' } });
    expect(got[1].rule).toMatchObject({ condition: 'between', value: '1', value2: '9' });
    expect(got[2].rule).toMatchObject({ condition: 'containsText', value: 'urgent' });
    expect(got[3].rule).toMatchObject({ condition: 'isEmpty' });
    expect(got[4].rule).toMatchObject({ kind: 'colorScale', minColor: '#ff0000', midColor: '#ffff00', maxColor: '#00ff00' });
    expect(got[5].rule).toMatchObject({ kind: 'dataBar', color: '#3366cc' });
    expect(got[6].rule).toMatchObject({ kind: 'iconSet', iconSet: 'arrows' });
    expect(got[7].rule).toMatchObject({ kind: 'topBottom', direction: 'bottom', type: 'percent', value: 15 });
    expect(got[8].rule).toMatchObject({ kind: 'average', direction: 'below' });
    expect(got[9].rule).toMatchObject({ kind: 'formula', formula: '=A1>B1' });
    expect(got[10]).toMatchObject({ stopIfTrue: true });
  });

  /**
   * The kinds with no OOXML operator go to the extras part and come back
   * exactly — and an approximation is still written to the worksheet, so Excel
   * shows the cell as flagged rather than as plain.
   */
  it('carries the rules OOXML has no operator for, through the extras part', async () => {
    const rules = [
      { id: 'p', range: 'A1:A9', rule: { kind: 'progressBar', minValue: 0, maxValue: 50, color: '#22aa66', showLabel: true } },
      { id: 's', range: 'B1:B9', rule: { kind: 'statusIndicator', template: 'priority' } },
      { id: 'h', range: 'C1:C9', rule: { kind: 'heatMap', preset: 'financial', lowColor: '#ff0000', highColor: '#00ff00' } },
      { id: 't', range: 'D1:D9', rule: { kind: 'themeColor', condition: 'greaterThan', value: '3', token: 'danger' } },
      { id: 'v', range: 'E1:E9', rule: { kind: 'variable', variableName: 'overdue' } },
      { id: 'd', range: 'F1:F9', rule: { kind: 'singleColor', condition: 'dateIsPastDue', format: { color: '#aa0000' } } },
    ];
    const input = file({
      cells: Object.fromEntries([cell('A1', '1')]),
      conditionalFormats: rules as never,
      cfVariables: [{ name: 'overdue', rule: { kind: 'duplicates', format: {} } }] as never,
    });
    const bytes = await writeXlsx(input);
    const out = (await readXlsx(bytes)).sheets[0];

    expect(out.conditionalFormats).toEqual(rules);
    expect(out.cfVariables).toEqual(input.sheets[0].cfVariables);
    // Excel still gets something for each of them.
    expect(await partOf(bytes, 'xl/worksheets/sheet1.xml')).toMatch(/type="dataBar"/);
  });

  // ── Tables, charts and the leftovers ───────────────────────────────────────

  it('carries a table region and its Neutrino style', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([cell('A1', 'Name'), cell('B1', 'Qty'), cell('A2', 'Widget'), cell('B2', '2')]),
      tables: [{ id: 't1', styleId: 'blue-medium', minR: 1, maxR: 2, minC: 1, maxC: 2 }],
    }));

    expect(out.tables).toHaveLength(1);
    expect(out.tables![0]).toMatchObject({ styleId: 'blue-medium', minR: 1, maxR: 2, minC: 1, maxC: 2 });
  });

  it('carries charts, which have no OOXML written for them', async () => {
    const chart = { id: 'c1', type: 'column', title: 'Sales', dataRange: 'A1:B4' };
    const out = await roundTrip(file({
      cells: Object.fromEntries([cell('A1', '1')]),
      charts: [chart] as never,
    }));

    expect(out.charts).toEqual([chart]);
  });

  it('carries the clip wrap mode, which OOXML has no third state for', async () => {
    const out = await roundTrip(file({
      cells: Object.fromEntries([
        cell('A1', 'x', { cellStyle: { wrapMode: 'clip' } }),
        cell('A2', 'y', { cellStyle: { wrapMode: 'wrap' } }),
      ]),
    }));

    expect(out.cells.A1.cellStyle).toMatchObject({ wrapMode: 'clip' });
    expect(out.cells.A2.cellStyle).toMatchObject({ wrapMode: 'wrap' });
  });

  it('writes no extras part for a spreadsheet with no leftovers', async () => {
    const bytes = await writeXlsx(file({ cells: Object.fromEntries([cell('A1', 'plain')]) }));
    expect(await partOf(bytes, 'customXml/item1.xml')).toBeNull();
  });

  // ── Foreign readers ────────────────────────────────────────────────────────

  it('writes a workbook SheetJS reads the same way', async () => {
    const bytes = await writeXlsx(file({
      name: 'Data',
      cells: Object.fromEntries([
        cell('A1', 'Widget'),
        cell('B1', '42'),
        ['C1', { id: 'C1', raw: '=B1*2', value: '84' }],
        cell('A2', 'merged', { colSpan: 2 }),
      ]),
      colWidths: { '0': 180 },
    }));

    const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
    expect(wb.SheetNames).toEqual(['Data']);
    const ws = wb.Sheets.Data;
    expect(ws.A1.v).toBe('Widget');
    expect(ws.B1).toMatchObject({ v: 42, t: 'n' });
    expect(ws.C1.f).toBe('B1*2');
    expect(ws['!merges']).toEqual([{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }]);
  });

  /**
   * A workbook that has been through Excel can carry pivot tables, images and
   * chart parts this writer has no notion of. Dropping them on every autosave
   * would make Neutrino the tool that quietly deletes your pivot table.
   */
  it('carries forward the parts of an existing package it does not understand', async () => {
    const first = await writeXlsx(file({ cells: Object.fromEntries([cell('A1', '1')]) }));
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(first);
    zip.file('xl/pivotTables/pivotTable1.xml', '<pivotTableDefinition/>');
    const withPivot = await zip.generateAsync({ type: 'uint8array' });

    const next = await writeXlsx(file({ cells: Object.fromEntries([cell('A1', '2')]) }), withPivot);

    expect(await partOf(next, 'xl/pivotTables/pivotTable1.xml')).toBe('<pivotTableDefinition/>');
    expect((await readXlsx(next)).sheets[0].cells.A1.raw).toBe('2');
  });

  it('reads a workbook written by something else', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Qty'], ['Widget', 2]]), 'Foreign');
    const bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);

    const out = await readXlsx(bytes);
    expect(out.sheets[0].name).toBe('Foreign');
    expect(out.sheets[0].cells.A1.raw).toBe('Name');
    expect(out.sheets[0].cells.B2.raw).toBe('2');
  });

  it('refuses bytes that are not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('{"sheets":[]}'))).rejects.toThrow();
  });
});

/** One part of a package as text, or `null` when it is not there. */
async function partOf(bytes: Uint8Array, path: string): Promise<string | null> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(path);
  return entry ? entry.async('string') : null;
}
