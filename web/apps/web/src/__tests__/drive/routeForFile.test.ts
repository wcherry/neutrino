/**
 * Unit tests for routeForFile.
 *
 * routeForFile encapsulates the mimetype -> route dispatch previously
 * duplicated 3x in drive/page.tsx (handleGridItemClick, the starred
 * quick-access onClick, and FileContextMenu.onPreview). It must:
 *  - Route the bespoke-JSON Neutrino mimetypes (doc/sheet/slide/diagram/
 *    drawing/note) into their editors.
 *  - Route `.docx`/`.xlsx`/`.pptx` into Docs/Sheets/Slides. Since issue #127
 *    that is the format those editors *write*, so a file uploaded from Word
 *    and one created here are the same kind of thing and open the same way.
 *    This used to be gated behind the `officeInPlaceEditing` flag, which is
 *    gone: a flag that could turn it off would leave every document created
 *    from that point on unopenable.
 *  - Detect the format from the extension when the mimetype is a generic
 *    `application/octet-stream`, which is what a browser reports for an upload.
 *  - Route images to the photo editor.
 *  - Call onPreviewFallback for anything else — including legacy
 *    `.doc`/`.xls`/`.ppt`, which `officeAppForFile` never matches, since the
 *    in-browser parsers cannot read them.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeForFile, previewKindForMime } from '../../app/(apps)/drive/routeForFile';

const DOC_MIME = 'application/x-neutrino-doc';
const SHEET_MIME = 'application/x-neutrino-sheet';
const SLIDES_MIME = 'application/x-neutrino-slide';
const DIAGRAM_MIME = 'application/x-neutrino-diagram';
const DRAWING_MIME = 'application/x-neutrino-drawing';
const NOTE_MIME = 'application/x-neutrino-note';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function makeRouter() {
  return { push: vi.fn() };
}

function makeOpts() {
  return { onPreviewFallback: vi.fn() };
}

describe('routeForFile — bespoke-JSON mimetypes', () => {
  it.each([
    ['doc', DOC_MIME, '/docs/editor?id='],
    ['sheet', SHEET_MIME, '/sheets/editor?id='],
    ['slide', SLIDES_MIME, '/slides/editor?id='],
    ['diagram', DIAGRAM_MIME, '/diagrams/editor?id='],
    ['drawing', DRAWING_MIME, '/drawing/editor?id='],
    ['note', NOTE_MIME, '/notes/editor?id='],
  ])('routes a native %s file to its editor', (_label, mimeType, expectedPrefix) => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile({ id: 'file-1', mimeType, name: 'Item' }, router, opts);
    expect(router.push).toHaveBeenCalledWith(`${expectedPrefix}file-1`);
    expect(opts.onPreviewFallback).not.toHaveBeenCalled();
  });

});

describe('routeForFile — OOXML formats', () => {
  it('routes a .docx file to the docs editor', () => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile({ id: 'file-3', mimeType: DOCX_MIME, name: 'report.docx' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/docs/editor?id=file-3');
    expect(opts.onPreviewFallback).not.toHaveBeenCalled();
  });

  it('routes a .xlsx file to the sheets editor', () => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile({ id: 'file-4', mimeType: XLSX_MIME, name: 'budget.xlsx' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/sheets/editor?id=file-4');
  });

  it('routes a .pptx file to the slides editor', () => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile({ id: 'file-5', mimeType: PPTX_MIME, name: 'deck.pptx' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/slides/editor?id=file-5');
  });

  it('detects office format via extension fallback when mimetype is octet-stream', () => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile(
      { id: 'file-6', mimeType: 'application/octet-stream', name: 'report.docx' },
      router,
      opts
    );
    expect(router.push).toHaveBeenCalledWith('/docs/editor?id=file-6');
  });
});

describe('routeForFile — legacy formats are never treated as office files', () => {
  it.each([
    ['doc', 'application/msword', 'legacy.doc'],
    ['xls', 'application/vnd.ms-excel', 'legacy.xls'],
    ['ppt', 'application/vnd.ms-powerpoint', 'legacy.ppt'],
  ])('falls through to preview for legacy .%s files even with the office flag on', (_label, mimeType, name) => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile({ id: 'file-8', mimeType, name }, router, opts);
    expect(router.push).not.toHaveBeenCalled();
    expect(opts.onPreviewFallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-8' })
    );
  });
});

describe('routeForFile — images and fallback', () => {
  it('routes images to the photo editor regardless of the office flag', () => {
    const router = makeRouter();
    const opts = makeOpts();
    routeForFile({ id: 'file-9', mimeType: 'image/png', name: 'photo.png' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/photos/editor?fileId=file-9');
  });

  it('calls onPreviewFallback for an unrelated file type', () => {
    const router = makeRouter();
    const opts = makeOpts();
    const file = { id: 'file-10', mimeType: 'application/pdf', name: 'invoice.pdf' };
    routeForFile(file, router, opts);
    expect(router.push).not.toHaveBeenCalled();
    expect(opts.onPreviewFallback).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-10' }));
  });
});

/**
 * Regression coverage for issue #68 — the Drive context menu's "Preview"
 * action used to call routeForFile itself, which unconditionally navigates
 * native Neutrino mimetypes and images into their editor. previewKindForMime
 * is the dedicated dispatch for the Preview action: it must identify a
 * lightweight in-place preview kind for every type that has one, and defer
 * (return null) only for types with no preview renderer.
 */
describe('previewKindForMime', () => {
  it.each([
    ['doc', DOC_MIME],
    ['sheet', SHEET_MIME],
    ['slide', SLIDES_MIME],
    ['note', NOTE_MIME],
    ['diagram', DIAGRAM_MIME],
    ['drawing', DRAWING_MIME],
  ])('resolves %s mimetypes to their preview kind', (expectedKind, mimeType) => {
    expect(previewKindForMime(mimeType)).toBe(expectedKind);
  });

  /**
   * Both formats preview the same way — the modal reads the model out of an
   * OOXML package and the stored JSON otherwise. These used to return null,
   * which since issue #127 would take the Preview action away from every
   * document created from that point on.
   */
  it.each([
    ['doc', DOCX_MIME],
    ['sheet', XLSX_MIME],
    ['slide', PPTX_MIME],
  ])('resolves OOXML mimetypes to the same %s preview kind', (expectedKind, mimeType) => {
    expect(previewKindForMime(mimeType)).toBe(expectedKind);
  });

  it('resolves images to the "image" preview kind', () => {
    expect(previewKindForMime('image/png')).toBe('image');
    expect(previewKindForMime('image/jpeg')).toBe('image');
  });

  it('returns null for types with no dedicated preview renderer', () => {
    expect(previewKindForMime('application/pdf')).toBeNull();
    // Legacy binary Office: nothing in the browser can read one.
    expect(previewKindForMime('application/msword')).toBeNull();
  });
});
