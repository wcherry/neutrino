/**
 * Unit tests for officeAppForFile / OFFICE_MIME (issue #43 — in-place editing of
 * MS Office docs).
 *
 * `officeAppForFile` must:
 *  - Match modern OOXML mimetypes (.docx/.xlsx/.pptx) to their editor app.
 *  - Fall back to the file extension when the browser reports a generic
 *    mimetype (application/octet-stream) or an empty string — this mirrors the
 *    real upload path, see UploadZone.tsx:63 where `entry.file.type` is often
 *    empty/octet-stream for these formats in some browsers/OSes.
 *  - Never match legacy binary Office formats (.doc/.xls/.ppt), even if the
 *    filename extension could be confused with the modern one (e.g. a file
 *    literally named "report.doc" must return null, not 'docs').
 *  - Return null for anything unrelated (images, PDFs, plain text, etc).
 *
 * This module does not exist yet (red phase / TDD) — these tests are expected
 * to fail with a "Cannot find module" error until officeFormats.ts lands at
 * web/apps/web/src/lib/officeFormats.ts.
 */

import { describe, it, expect } from 'vitest';
import { OFFICE_MIME, officeAppForFile } from '../../lib/officeFormats';

describe('OFFICE_MIME', () => {
  it('maps docx/xlsx/pptx to the real OOXML mimetypes', () => {
    expect(OFFICE_MIME.docx).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(OFFICE_MIME.xlsx).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(OFFICE_MIME.pptx).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
  });
});

describe('officeAppForFile — mimetype match', () => {
  it('returns "docs" for a real .docx mimetype', () => {
    expect(officeAppForFile(OFFICE_MIME.docx, 'report.docx')).toBe('docs');
  });

  it('returns "sheets" for a real .xlsx mimetype', () => {
    expect(officeAppForFile(OFFICE_MIME.xlsx, 'budget.xlsx')).toBe('sheets');
  });

  it('returns "slides" for a real .pptx mimetype', () => {
    expect(officeAppForFile(OFFICE_MIME.pptx, 'deck.pptx')).toBe('slides');
  });

  it('matches by mimetype even when the filename has no extension', () => {
    expect(officeAppForFile(OFFICE_MIME.docx, 'report')).toBe('docs');
  });
});

describe('officeAppForFile — extension fallback', () => {
  it('falls back to .docx extension when mimetype is application/octet-stream', () => {
    expect(officeAppForFile('application/octet-stream', 'report.docx')).toBe('docs');
  });

  it('falls back to .xlsx extension when mimetype is application/octet-stream', () => {
    expect(officeAppForFile('application/octet-stream', 'budget.xlsx')).toBe('sheets');
  });

  it('falls back to .pptx extension when mimetype is application/octet-stream', () => {
    expect(officeAppForFile('application/octet-stream', 'deck.pptx')).toBe('slides');
  });

  it('falls back to .docx extension when mimetype is an empty string', () => {
    expect(officeAppForFile('', 'report.docx')).toBe('docs');
  });

  it('extension match is case-insensitive', () => {
    expect(officeAppForFile('', 'REPORT.DOCX')).toBe('docs');
  });
});

describe('officeAppForFile — legacy formats rejected', () => {
  it('returns null for a real .doc mimetype', () => {
    expect(
      officeAppForFile('application/msword', 'legacy.doc')
    ).toBeNull();
  });

  it('returns null for a real .xls mimetype', () => {
    expect(
      officeAppForFile('application/vnd.ms-excel', 'legacy.xls')
    ).toBeNull();
  });

  it('returns null for a real .ppt mimetype', () => {
    expect(
      officeAppForFile('application/vnd.ms-powerpoint', 'legacy.ppt')
    ).toBeNull();
  });

  it('returns null for a .doc file even with an octet-stream mimetype (extension fallback must not match legacy extensions)', () => {
    expect(officeAppForFile('application/octet-stream', 'legacy.doc')).toBeNull();
  });

  it('returns null for a .xls file even with an octet-stream mimetype', () => {
    expect(officeAppForFile('application/octet-stream', 'legacy.xls')).toBeNull();
  });

  it('returns null for a .ppt file even with an octet-stream mimetype', () => {
    expect(officeAppForFile('application/octet-stream', 'legacy.ppt')).toBeNull();
  });
});

describe('officeAppForFile — unrelated files', () => {
  it('returns null for a PDF', () => {
    expect(officeAppForFile('application/pdf', 'invoice.pdf')).toBeNull();
  });

  it('returns null for a PNG image', () => {
    expect(officeAppForFile('image/png', 'photo.png')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(officeAppForFile('text/plain', 'notes.txt')).toBeNull();
  });

  it('returns null for an unrecognized octet-stream file with no matching extension', () => {
    expect(officeAppForFile('application/octet-stream', 'archive.zip')).toBeNull();
  });

  it('returns null for a native Neutrino doc mimetype', () => {
    expect(officeAppForFile('application/x-neutrino-doc', 'My Doc')).toBeNull();
  });
});
