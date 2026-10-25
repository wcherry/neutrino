/**
 * What kind of file a picked file is (`lib/localImport/classify.ts`).
 *
 * The kind decides where a file can go: media into Photos (and so Drive),
 * office files into Drive where Docs/Sheets/Slides open them byte for byte,
 * Markdown into Notes. A file put in the wrong kind lands somewhere the user
 * did not choose, so the edges are pinned here — legacy Office formats and
 * SVG in particular, which look like their neighbours but open nowhere near
 * them.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  mimeTypeFor,
  isIgnoredPath,
  IMPORT_KINDS,
} from '@/lib/localImport/classify';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOTX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('IMPORT_KINDS', () => {
  it('lists the four kinds in display order', () => {
    expect(IMPORT_KINDS).toEqual(['media', 'office', 'markdown', 'other']);
  });
});

describe('classifyFile — media', () => {
  it.each(['image/jpeg', 'image/png', 'image/heic', 'video/mp4', 'video/quicktime'])(
    'treats mime %s as media',
    (mime) => {
      expect(classifyFile('whatever.bin', mime)).toBe('media');
    },
  );

  it.each([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'tif', 'tiff', 'bmp', 'dng',
    'mov', 'mp4', 'm4v', 'webm', '3gp', 'avi', 'mkv',
  ])('treats a .%s with no browser mime as media', (ext) => {
    expect(classifyFile(`IMG_0001.${ext}`, '')).toBe('media');
  });

  it('matches media extensions case-insensitively', () => {
    expect(classifyFile('IMG_0001.JPG', '')).toBe('media');
    expect(classifyFile('clip.MOV', '')).toBe('media');
  });

  it('does not treat SVG as media, by mime or by extension — it opens in Diagrams', () => {
    expect(classifyFile('logo.svg', 'image/svg+xml')).toBe('other');
    expect(classifyFile('logo.svg', '')).toBe('other');
  });
});

describe('classifyFile — office', () => {
  it.each([
    ['report.docx', DOCX],
    ['letter.dotx', DOTX],
    ['budget.xlsx', XLSX],
    ['deck.pptx', PPTX],
  ])('treats %s with its office mime as office', (name, mime) => {
    expect(classifyFile(name, mime)).toBe('office');
  });

  it.each(['report.docx', 'letter.dotx', 'budget.xlsx', 'deck.pptx'])(
    'treats %s with no browser mime as office',
    (name) => {
      expect(classifyFile(name, '')).toBe('office');
    },
  );

  it('matches office extensions case-insensitively', () => {
    expect(classifyFile('REPORT.DOCX', '')).toBe('office');
    expect(classifyFile('Budget.XlSx', 'application/octet-stream')).toBe('office');
  });

  it.each([
    ['old.doc', 'application/msword'],
    ['old.xls', 'application/vnd.ms-excel'],
    ['old.ppt', 'application/vnd.ms-powerpoint'],
  ])('leaves legacy %s as other, since no editor opens it', (name, mime) => {
    expect(classifyFile(name, mime)).toBe('other');
    expect(classifyFile(name, '')).toBe('other');
  });
});

describe('classifyFile — markdown', () => {
  it.each(['notes.md', 'notes.markdown', 'NOTES.MD'])('treats %s as markdown', (name) => {
    expect(classifyFile(name, '')).toBe('markdown');
  });

  it('treats the text/markdown mime as markdown whatever the name', () => {
    expect(classifyFile('notes', 'text/markdown')).toBe('markdown');
  });
});

describe('classifyFile — other', () => {
  it.each([
    ['paper.pdf', 'application/pdf'],
    ['readme.txt', 'text/plain'],
    ['backup.zip', 'application/zip'],
    ['data.csv', 'text/csv'],
    ['Makefile', ''],
  ])('treats %s as other', (name, mime) => {
    expect(classifyFile(name, mime)).toBe('other');
  });
});

describe('mimeTypeFor', () => {
  it('keeps the browser type when it reported one', () => {
    expect(mimeTypeFor('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('weird.bin', 'application/x-custom')).toBe('application/x-custom');
  });

  it.each([
    ['report.docx', DOCX],
    ['budget.xlsx', XLSX],
    ['deck.pptx', PPTX],
    ['notes.md', 'text/markdown'],
    ['IMG_1.jpg', 'image/jpeg'],
    ['shot.png', 'image/png'],
    ['IMG_2.heic', 'image/heic'],
    ['clip.mov', 'video/quicktime'],
    ['clip.mp4', 'video/mp4'],
  ])('infers %s → %s when the browser reported nothing', (name, expected) => {
    expect(mimeTypeFor(name, '')).toBe(expected);
  });

  it('infers from the extension when the browser reported application/octet-stream', () => {
    expect(mimeTypeFor('report.docx', 'application/octet-stream')).toBe(DOCX);
  });

  it('infers case-insensitively', () => {
    expect(mimeTypeFor('IMG_1.JPG', '')).toBe('image/jpeg');
  });

  it('falls back to application/octet-stream for an unknown extension', () => {
    expect(mimeTypeFor('mystery.qqq', '')).toBe('application/octet-stream');
    expect(mimeTypeFor('Makefile', '')).toBe('application/octet-stream');
  });

  it('gives a .md the browser could not type text/markdown, so it is a note', () => {
    expect(mimeTypeFor('ideas.md', '')).toBe('text/markdown');
  });
});

describe('isIgnoredPath', () => {
  it.each([
    'Trip/.DS_Store',
    'Trip/._IMG_1.jpg',
    'proj/.git/config',
    'Thumbs.db',
    'a/desktop.ini',
    'a/thumbs.DB',
    'a/Desktop.INI',
  ])('ignores OS clutter at %s', (path) => {
    expect(isIgnoredPath(path)).toBe(true);
  });

  it.each(['Trip/IMG_1.jpg', 'notes/readme.md', 'loose.txt'])('keeps %s', (path) => {
    expect(isIgnoredPath(path)).toBe(false);
  });
});
