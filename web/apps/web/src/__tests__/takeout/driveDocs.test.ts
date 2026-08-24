/**
 * Tests for finding documents in an archive (`lib/takeout/driveDocs.ts`).
 *
 * The interesting cases are all about telling documents apart from everything
 * else a Drive export contains: a spreadsheet is not a document, a PDF is a
 * document we cannot convert and have to say so about, and Keep's per-note
 * HTML must never be mistaken for one.
 */

import { describe, it, expect } from 'vitest';
import { findDriveDocs, readDocInfo } from '@/lib/takeout/driveDocs';
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

describe('findDriveDocs', () => {
  it('picks up the formats it can convert and ignores everything else', () => {
    const found = findDriveDocs(
      archiveOf({
        Drive: [
          entry('Report.docx'),
          entry('Page.html'),
          entry('Notes.txt'),
          entry('Budget.xlsx'),
          entry('Deck.pptx'),
          entry('logo.png'),
        ],
      }),
    );

    expect(found).toMatchObject({ directory: 'Drive' });
    expect(found!.docs.map((d) => [d.title, d.format])).toEqual([
      ['Report', 'docx'],
      ['Page', 'html'],
      ['Notes', 'text'],
    ]);
    expect(found!.unsupported).toEqual([]);
  });

  it('reports the document formats it cannot convert instead of dropping them', () => {
    const found = findDriveDocs(archiveOf({ Drive: [entry('a.pdf'), entry('b.odt'), entry('c.rtf'), entry('d.png')] }));

    expect(found!.docs).toEqual([]);
    expect(found!.unsupported).toEqual([
      { path: 'a.pdf', format: 'PDF' },
      { path: 'b.odt', format: 'OpenDocument text' },
      { path: 'c.rtf', format: 'Rich Text' },
    ]);
  });

  it('records the folders a document sat in', () => {
    const found = findDriveDocs(archiveOf({ Drive: [entry('Work/2026/Q3 plan.docx')] }));
    expect(found!.docs[0]).toMatchObject({ title: 'Q3 plan', path: ['Work', '2026'] });
  });

  it('recognises a Drive folder Google localised, by the .docx in it', () => {
    const found = findDriveDocs(archiveOf({ Laufwerk: [entry('Bericht.docx')] }));
    expect(found).toMatchObject({ directory: 'Laufwerk' });
  });

  it('never mistakes Keep’s per-note HTML for documents', () => {
    const found = findDriveDocs(
      archiveOf({ Keep: [entry('note.json', '{}'), entry('note.html'), entry('Labels.txt')] }),
    );
    expect(found).toBeNull();
  });

  it('prefers the folder named Drive over one that merely holds a .docx', () => {
    const found = findDriveDocs(
      archiveOf({ Drive: [entry('a.docx')], Elsewhere: [entry('b.docx'), entry('c.docx')] }),
    );
    expect(found).toMatchObject({ directory: 'Drive' });
  });

  it('returns null when the archive holds no documents at all', () => {
    expect(findDriveDocs(archiveOf({ Drive: [entry('holiday.jpg')] }))).toBeNull();
    expect(findDriveDocs(archiveOf({ Calendar: [entry('me.ics')] }))).toBeNull();
  });

  it('attaches the metadata sidecar, under either name Takeout has used', () => {
    const found = findDriveDocs(
      archiveOf({
        Drive: [
          entry('a.docx'),
          entry('a.docx-info.json'),
          entry('Work/b.docx'),
          entry('Work/b-info.json'),
          entry('c.docx'),
        ],
      }),
    );

    const byTitle = Object.fromEntries(found!.docs.map((d) => [d.title, d.info?.path]));
    expect(byTitle).toEqual({ a: 'a.docx-info.json', b: 'Work/b-info.json', c: undefined });
  });
});

describe('readDocInfo', () => {
  it('reads the title Google recorded, which the filename may have mangled', async () => {
    const info = await readDocInfo(entry('a-info.json', JSON.stringify({ title: 'Q3: plan/final' })));
    expect(info).toEqual({ title: 'Q3: plan/final', description: undefined });
  });

  it('falls back to nothing rather than failing on a sidecar it cannot read', async () => {
    expect(await readDocInfo(entry('a-info.json', 'not json'))).toBeNull();
    expect(await readDocInfo(entry('a-info.json', '[]'))).toBeNull();
    expect(await readDocInfo(undefined)).toBeNull();
  });

  it('ignores an empty title so the filename stays in charge', async () => {
    const info = await readDocInfo(entry('a-info.json', JSON.stringify({ title: '   ' })));
    expect(info!.title).toBeUndefined();
  });

  // ── Dates (issue #110) ──────────────────────────────────────────────────

  it('reads the dates Drive recorded for the file', async () => {
    const info = await readDocInfo(
      entry(
        'a-info.json',
        JSON.stringify({ created_date: '2014-03-01T12:00:00Z', modified_date: '2016-07-04T09:30:00Z' }),
      ),
    );

    expect(info).toMatchObject({
      createdAt: '2014-03-01T12:00:00.000Z',
      modifiedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  /**
   * The exact spelling has moved between Takeout versions, so each date is
   * looked for under several names — the same leniency the title gets.
   */
  it('accepts the other spellings Takeout has used', async () => {
    const info = await readDocInfo(
      entry('a-info.json', JSON.stringify({ createdTime: '2014-03-01T12:00:00Z', modifiedTime: '2016-07-04T09:30:00Z' })),
    );

    expect(info).toMatchObject({
      createdAt: '2014-03-01T12:00:00.000Z',
      modifiedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  /**
   * A name we don't know about, or a date we can't parse, has to leave the
   * file to the zip entry's date rather than putting nonsense on the row.
   */
  it('leaves a date it cannot read undefined', async () => {
    const info = await readDocInfo(
      entry('a-info.json', JSON.stringify({ created_date: 'last Tuesday', modified_date: '' })),
    );

    expect(info!.createdAt).toBeUndefined();
    expect(info!.modifiedAt).toBeUndefined();
  });
});
