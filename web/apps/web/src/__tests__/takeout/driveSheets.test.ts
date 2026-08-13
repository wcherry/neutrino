/**
 * Tests for finding spreadsheets in an archive (`lib/takeout/driveSheets.ts`).
 *
 * The interesting cases are the mirror image of the docs finder's: a document
 * is not a spreadsheet, an OpenDocument spreadsheet is one we cannot convert
 * and have to say so about, and both finders have to read the same Drive
 * directory without either taking the other's files.
 */

import { describe, it, expect } from 'vitest';
import { findDriveSheets, readSheetInfo } from '@/lib/takeout/driveSheets';
import { findDriveDocs } from '@/lib/takeout/driveDocs';
import type { TakeoutArchive, TakeoutEntry } from '@/lib/takeout/archive';

function entry(path: string, text = ''): TakeoutEntry {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return {
    path,
    fullPath: `Takeout/${path}`,
    ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : '',
    size: 0,
    text: async () => text,
    blob: async () => new Blob([]),
  };
}

function archiveOf(products: Record<string, TakeoutEntry[]>): TakeoutArchive {
  const list = Object.entries(products).map(([name, entries]) => ({ name, entries }));
  return {
    root: 'Takeout/',
    products: list,
    product: (name) => list.find((p) => p.name.toLowerCase() === name.toLowerCase()),
    close: async () => {},
  };
}

describe('findDriveSheets', () => {
  it('picks up the formats it can convert and ignores everything else', () => {
    const found = findDriveSheets(
      archiveOf({
        Drive: [
          entry('Budget.xlsx'),
          entry('Rows.csv'),
          entry('Columns.tsv'),
          entry('Report.docx'),
          entry('Deck.pptx'),
          entry('logo.png'),
        ],
      }),
    );

    expect(found).toMatchObject({ directory: 'Drive' });
    expect(found!.sheets.map((s) => [s.title, s.format])).toEqual([
      ['Budget', 'xlsx'],
      ['Rows', 'csv'],
      ['Columns', 'tsv'],
    ]);
    expect(found!.unsupported).toEqual([]);
  });

  it('reports the spreadsheet formats it cannot convert instead of dropping them', () => {
    const found = findDriveSheets(archiveOf({ Drive: [entry('a.ods'), entry('b.xls'), entry('c.png')] }));

    expect(found!.sheets).toEqual([]);
    expect(found!.unsupported).toEqual([
      { path: 'a.ods', format: 'OpenDocument spreadsheet' },
      { path: 'b.xls', format: 'Excel 97–2003' },
    ]);
  });

  it('records the folders a spreadsheet sat in', () => {
    const found = findDriveSheets(archiveOf({ Drive: [entry('Work/2026/Budget.xlsx')] }));
    expect(found!.sheets[0]).toMatchObject({ title: 'Budget', path: ['Work', '2026'] });
  });

  it('recognises a Drive folder Google localised, by the .xlsx in it', () => {
    const found = findDriveSheets(archiveOf({ Laufwerk: [entry('Haushalt.xlsx')] }));
    expect(found).toMatchObject({ directory: 'Laufwerk' });
  });

  it('pairs a spreadsheet with its metadata sidecar, named either way', () => {
    const found = findDriveSheets(
      archiveOf({
        Drive: [
          entry('a.xlsx'),
          entry('a.xlsx-info.json'),
          entry('b.xlsx'),
          entry('b-info.json'),
          entry('c.xlsx'),
        ],
      }),
    );

    expect(found!.sheets.map((s) => s.info?.path)).toEqual(['a.xlsx-info.json', 'b-info.json', undefined]);
  });

  it('leaves a Drive directory of documents alone', () => {
    expect(findDriveSheets(archiveOf({ Drive: [entry('Report.docx'), entry('logo.png')] }))).toBeNull();
  });

  it('finds nothing in an archive with no Drive directory', () => {
    expect(findDriveSheets(archiveOf({ Keep: [entry('note.json'), entry('note.html')] }))).toBeNull();
  });

  it('does not take Keep’s files even when Keep is the only product', () => {
    // Keep writes a `.csv` for none of its notes, but the guard that matters is
    // that a directory is only Drive by name or by its `.xlsx`.
    expect(findDriveSheets(archiveOf({ Keep: [entry('note.json'), entry('note.html')] }))).toBeNull();
  });

  it('splits one Drive directory between the two finders without overlap', () => {
    const archive = archiveOf({ Drive: [entry('Report.docx'), entry('Budget.xlsx'), entry('Notes.txt')] });

    expect(findDriveDocs(archive)!.docs.map((d) => d.entry.path)).toEqual(['Report.docx', 'Notes.txt']);
    expect(findDriveSheets(archive)!.sheets.map((s) => s.entry.path)).toEqual(['Budget.xlsx']);
  });
});

describe('readSheetInfo', () => {
  it('reads the title out of a sidecar', async () => {
    expect(await readSheetInfo(entry('a.xlsx-info.json', '{"title":"Q3: budget"}'))).toEqual({
      title: 'Q3: budget',
      description: undefined,
    });
  });

  it('falls back to nothing when there is no sidecar or it makes no sense', async () => {
    expect(await readSheetInfo(undefined)).toBeNull();
    expect(await readSheetInfo(entry('a.xlsx-info.json', 'not json'))).toBeNull();
    expect(await readSheetInfo(entry('a.xlsx-info.json', '[]'))).toBeNull();
  });
});
