/**
 * Tests for the spreadsheet conversion (`lib/takeout/sheetXlsx.ts`).
 *
 * These go through real .xlsx bytes rather than a hand-built workbook object,
 * because the questions worth asking are about what survives the file format:
 * whether a percentage is still a number, whether a formula is still a
 * formula, and whether a date is still the day it was in the export.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { delimitedToSheetFile, xlsxToSheetFile } from '@/lib/takeout/sheetXlsx';
import type { WorkSheet } from 'xlsx';

const WITH_FORMULAS = { importFormulas: true };

/** Real .xlsx bytes for one or more named worksheets. */
function xlsxBytes(sheets: Record<string, WorkSheet>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

const grid = (rows: unknown[][]): WorkSheet => XLSX.utils.aoa_to_sheet(rows);

/**
 * An .xlsx built from its XML, for the parts SheetJS's writer drops: it does
 * not emit `<cols>` or row heights, so a workbook it wrote could never tell us
 * whether column widths are read back — while the exports this import exists
 * for carry them on every sheet.
 */
async function xlsxWithSizes(sheetXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`,
  );
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('xlsxToSheetFile', () => {
  it('turns each tab into a sheet of cells addressed the way the editor is', async () => {
    const file = await xlsxToSheetFile(
      xlsxBytes({ Data: grid([['Name', 'Qty'], ['Widget', 2]]), Notes: grid([['second']]) }),
      WITH_FORMULAS,
    );

    expect(file.sheets.map((s) => s.name)).toEqual(['Data', 'Notes']);
    expect(file.sheets[0].cells.A1).toMatchObject({ id: 'A1', raw: 'Name' });
    expect(file.sheets[0].cells.B2).toMatchObject({ id: 'B2', raw: '2', value: '2' });
    expect(file.sheets[1].cells.A1).toMatchObject({ raw: 'second' });
  });

  it('stores a number unformatted and carries its format alongside', async () => {
    const ws = grid([[0]]);
    // A percentage in a file is the number 0.155 under a `0.00%` format —
    // storing the *display* would leave a spreadsheet that cannot add up.
    ws.A1 = { t: 'n', v: 0.155, z: '0.00%', w: '15.50%' };
    const file = await xlsxToSheetFile(xlsxBytes({ Data: ws }), WITH_FORMULAS);

    expect(file.sheets[0].cells.A1).toEqual({
      id: 'A1',
      raw: '0.155',
      value: '15.50%',
      cellStyle: { customFormat: '0.00%' },
    });
  });

  it('leaves an unformatted cell without a style', async () => {
    const file = await xlsxToSheetFile(xlsxBytes({ Data: grid([[42]]) }), WITH_FORMULAS);
    expect(file.sheets[0].cells.A1.cellStyle).toBeUndefined();
  });

  it('keeps a date as the serial and format it is in the file', async () => {
    const ws = grid([[0]]);
    // 46246 is 2026-08-13. Kept as the serial rather than turned into a date
    // string, which the browser's timezone could move by a day.
    ws.A1 = { t: 'n', v: 46246, z: 'yyyy-mm-dd', w: '2026-08-13' };
    const file = await xlsxToSheetFile(xlsxBytes({ Data: ws }), WITH_FORMULAS);

    expect(file.sheets[0].cells.A1).toMatchObject({
      raw: '46246',
      cellStyle: { customFormat: 'yyyy-mm-dd' },
    });
  });

  it('brings a formula across as a formula, with its exported result', async () => {
    const ws = grid([[2, 3]]);
    ws.C1 = { t: 'n', f: 'A1+B1', v: 5, w: '5' };
    ws['!ref'] = 'A1:C1';
    const file = await xlsxToSheetFile(xlsxBytes({ Data: ws }), WITH_FORMULAS);

    expect(file.sheets[0].cells.C1).toMatchObject({ raw: '=A1+B1', value: '5' });
  });

  it('keeps only the computed value when formulas are turned off', async () => {
    const ws = grid([[2, 3]]);
    ws.C1 = { t: 'n', f: 'A1+B1', v: 5, w: '5' };
    ws['!ref'] = 'A1:C1';
    const file = await xlsxToSheetFile(xlsxBytes({ Data: ws }), { importFormulas: false });

    expect(file.sheets[0].cells.C1).toMatchObject({ raw: '5', value: '5' });
  });

  it('expands a merged range into an anchor and the cells it covers', async () => {
    const ws = grid([['Title', null], [1, 2]]);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    const file = await xlsxToSheetFile(xlsxBytes({ Data: ws }), WITH_FORMULAS);

    expect(file.sheets[0].cells.A1).toMatchObject({ raw: 'Title', colSpan: 2, rowSpan: 1 });
    expect(file.sheets[0].cells.B1).toMatchObject({ id: 'B1', mergeAnchor: 'A1' });
  });

  it('keeps booleans and error cells readable', async () => {
    const ws = grid([[0, 0]]);
    ws.A1 = { t: 'b', v: true, w: 'TRUE' };
    ws.B1 = { t: 'e', v: 0x17, w: '#REF!' };
    const file = await xlsxToSheetFile(xlsxBytes({ Data: ws }), WITH_FORMULAS);

    expect(file.sheets[0].cells.A1.raw).toBe('TRUE');
    expect(file.sheets[0].cells.B1.raw).toBe('#REF!');
  });

  it('stores nothing for the empty cells between the full ones', async () => {
    const file = await xlsxToSheetFile(
      xlsxBytes({ Data: grid([['a', null, null], [null, null, 'b']]) }),
      WITH_FORMULAS,
    );

    expect(Object.keys(file.sheets[0].cells).sort()).toEqual(['A1', 'C2']);
  });

  it('carries the column widths and row heights the file declares', async () => {
    // `customWidth` marks a column the user actually resized; `wch` is a count
    // of characters, which the editor needs as pixels.
    const file = await xlsxToSheetFile(
      await xlsxWithSizes(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<cols><col min="1" max="1" width="25" customWidth="1"/></cols>` +
          `<sheetData><row r="1" ht="40" customHeight="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row></sheetData>` +
          `</worksheet>`,
      ),
      WITH_FORMULAS,
    );

    // Keyed by 0-based index, as the editor's own colWidths/rowHeights are.
    expect(file.sheets[0].colWidths?.['0']).toBeGreaterThan(100);
    expect(file.sheets[0].rowHeights?.['0']).toBeGreaterThan(28);
  });

  it('leaves the sizing out entirely when the file says nothing about it', async () => {
    const file = await xlsxToSheetFile(xlsxBytes({ Data: grid([['a']]) }), WITH_FORMULAS);
    expect(file.sheets[0].colWidths).toBeUndefined();
    expect(file.sheets[0].rowHeights).toBeUndefined();
  });

  it('gives an empty workbook a tab to open on', async () => {
    const file = await xlsxToSheetFile(xlsxBytes({ Sheet1: grid([]) }), WITH_FORMULAS);
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].cells).toEqual({});
  });
});

describe('delimitedToSheetFile', () => {
  it('reads a CSV into one tab named after the file', async () => {
    const file = await delimitedToSheetFile(
      'Name,Qty\n"Widget, large",2\n',
      { name: 'Stock', separator: ',' },
      WITH_FORMULAS,
    );

    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].name).toBe('Stock');
    // The quoted comma is part of the value, not a column break.
    expect(file.sheets[0].cells.A2.raw).toBe('Widget, large');
    expect(file.sheets[0].cells.B2.raw).toBe('2');
  });

  it('splits a TSV on tabs, not on the commas in it', async () => {
    const file = await delimitedToSheetFile(
      'City\tNote\nBerlin\tone, two\n',
      { name: 'Places', separator: '\t' },
      WITH_FORMULAS,
    );

    expect(file.sheets[0].cells.B2.raw).toBe('one, two');
    expect(file.sheets[0].cells.C2).toBeUndefined();
  });

  it('reads an empty file as an empty tab rather than failing', async () => {
    const file = await delimitedToSheetFile('', { name: 'Empty', separator: ',' }, WITH_FORMULAS);
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].cells).toEqual({});
  });
});
