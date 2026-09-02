/**
 * Tests for finding presentations in an archive (`lib/takeout/driveSlides.ts`).
 *
 * Three finders now read the same Drive directory, so the cases that matter
 * are the boundaries between them: a document is not a deck, a deck is not a
 * spreadsheet, and the formats each of them reports as unconvertible have to
 * stay each finder's own — a `.pdf` in Drive says nothing about which app
 * wrote it, so only the docs finder speaks for it.
 */

import { describe, it, expect } from 'vitest';
import { findDriveSlides, readSlideInfo } from '@/lib/takeout/driveSlides';
import { findDriveDocs } from '@/lib/takeout/driveDocs';
import { findDriveSheets } from '@/lib/takeout/driveSheets';
import type { TakeoutArchive, TakeoutEntry } from '@/lib/takeout/archive';

function entry(path: string, text = '', lastModified: Date | null = null): TakeoutEntry {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return {
    path,
    fullPath: `Takeout/${path}`,
    ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : '',
    size: 0,
    lastModified,
    text: async () => text,
    blob: async () => new Blob([]),
  };
}

function archiveOf(products: Record<string, TakeoutEntry[]>): TakeoutArchive {
  const list = Object.entries(products).map(([name, entries]) => ({ name, entries }));
  return {
    root: 'Takeout/',
    partCount: 1,
    products: list,
    product: (name) => list.find((p) => p.name.toLowerCase() === name.toLowerCase()),
    close: async () => {},
  };
}

describe('findDriveSlides', () => {
  it('picks up the PowerPoint files and ignores everything else', () => {
    const found = findDriveSlides(
      archiveOf({
        Drive: [
          entry('Kickoff.pptx'),
          entry('Macros.pptm'),
          entry('Report.docx'),
          entry('Budget.xlsx'),
          entry('logo.png'),
        ],
      }),
    );

    expect(found).toMatchObject({ directory: 'Drive' });
    expect(found!.slides.map((s) => [s.title, s.format])).toEqual([
      ['Kickoff', 'pptx'],
      ['Macros', 'pptx'],
    ]);
    expect(found!.unsupported).toEqual([]);
  });

  it('reports the presentation formats it cannot open instead of dropping them', () => {
    const found = findDriveSlides(archiveOf({ Drive: [entry('a.odp'), entry('b.ppt'), entry('c.png')] }));

    expect(found!.slides).toEqual([]);
    expect(found!.unsupported).toEqual([
      { path: 'a.odp', format: 'OpenDocument presentation' },
      { path: 'b.ppt', format: 'PowerPoint 97–2003' },
    ]);
  });

  /**
   * A `.pdf` or a `.txt` in Drive is as likely to be an exported document as an
   * exported deck, and the docs finder already reports both — so this one says
   * nothing about them rather than telling the user twice about one file.
   */
  it('leaves the formats the docs finder speaks for to the docs finder', () => {
    const archive = archiveOf({ Drive: [entry('Deck.pdf'), entry('Notes.txt'), entry('Kickoff.pptx')] });

    expect(findDriveSlides(archive)!.unsupported).toEqual([]);
    expect(findDriveDocs(archive)!.unsupported).toEqual([{ path: 'Deck.pdf', format: 'PDF' }]);
  });

  it('records the folders a presentation sat in', () => {
    const found = findDriveSlides(archiveOf({ Drive: [entry('Work/2026/Kickoff.pptx')] }));
    expect(found!.slides[0]).toMatchObject({ title: 'Kickoff', path: ['Work', '2026'] });
  });

  it('recognises a Drive folder Google localised, by the .pptx in it', () => {
    const found = findDriveSlides(archiveOf({ Laufwerk: [entry('Vortrag.pptx')] }));
    expect(found).toMatchObject({ directory: 'Laufwerk' });
  });

  it('pairs a presentation with its metadata sidecar, named either way', () => {
    const found = findDriveSlides(
      archiveOf({
        Drive: [
          entry('a.pptx'),
          entry('a.pptx-info.json'),
          entry('b.pptx'),
          entry('b-info.json'),
          entry('c.pptx'),
        ],
      }),
    );

    expect(found!.slides.map((s) => s.info?.path)).toEqual(['a.pptx-info.json', 'b-info.json', undefined]);
  });

  it('leaves a Drive directory of documents and spreadsheets alone', () => {
    expect(findDriveSlides(archiveOf({ Drive: [entry('Report.docx'), entry('Budget.xlsx')] }))).toBeNull();
  });

  it('finds nothing in an archive with no Drive directory', () => {
    expect(findDriveSlides(archiveOf({ Keep: [entry('note.json'), entry('note.html')] }))).toBeNull();
  });

  it('splits one Drive directory between the three finders without overlap', () => {
    const archive = archiveOf({
      Drive: [entry('Report.docx'), entry('Budget.xlsx'), entry('Kickoff.pptx'), entry('Notes.txt')],
    });

    expect(findDriveDocs(archive)!.docs.map((d) => d.entry.path)).toEqual(['Report.docx', 'Notes.txt']);
    expect(findDriveSheets(archive)!.sheets.map((s) => s.entry.path)).toEqual(['Budget.xlsx']);
    expect(findDriveSlides(archive)!.slides.map((s) => s.entry.path)).toEqual(['Kickoff.pptx']);
  });
});

describe('readSlideInfo', () => {
  it('reads the title and the dates a sidecar recorded', async () => {
    const info = await readSlideInfo(
      entry(
        'a.pptx-info.json',
        JSON.stringify({
          title: 'Q3: kickoff',
          created_date: '2014-03-01T12:00:00Z',
          modified_date: '2016-07-04T09:30:00Z',
        }),
      ),
    );

    expect(info).toMatchObject({
      title: 'Q3: kickoff',
      createdAt: '2014-03-01T12:00:00.000Z',
      modifiedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  it('leaves the filename in charge when the sidecar makes no sense', async () => {
    expect(await readSlideInfo(entry('a.pptx-info.json', 'not json'))).toBeNull();
    expect(await readSlideInfo(undefined)).toBeNull();
  });
});
