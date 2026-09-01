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
import { delimitedToSheetFile } from '@/lib/takeout/sheetXlsx';
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
