/**
 * Unit tests for routeForFile (issue #43 — in-place editing of MS Office docs).
 *
 * routeForFile encapsulates the mimetype -> route dispatch previously
 * duplicated 3x in drive/page.tsx (handleGridItemClick, the starred
 * quick-access onClick, and FileContextMenu.onPreview — see page.tsx:289-312,
 * 560-584, 685-704). It must:
 *  - Route native Neutrino mimetypes (doc/sheet/slide/diagram/drawing) exactly
 *    as today, regardless of the office-editing flag.
 *  - When no native mimetype matches AND officeInPlaceEditingEnabled is true,
 *    detect office formats via officeAppForFile and route into the matching
 *    editor (/docs, /sheets, /slides).
 *  - When officeInPlaceEditingEnabled is false, office files must NOT be
 *    routed into an editor — they fall through to the existing image/
 *    preview-fallback behavior, identical to today's (pre-feature) behavior.
 *  - Images always route to the photo editor, independent of the office flag.
 *  - Anything else (and legacy .doc/.xls/.ppt, which officeAppForFile never
 *    matches) calls the onPreviewFallback callback instead of navigating.
 *
 * This module does not exist yet (red phase / TDD) — expected to fail with a
 * "Cannot find module" error until routeForFile.ts lands at
 * web/apps/web/src/app/(apps)/drive/routeForFile.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeForFile } from '../../app/(apps)/drive/routeForFile';

const DOC_MIME = 'application/x-neutrino-doc';
const SHEET_MIME = 'application/x-neutrino-sheet';
const SLIDES_MIME = 'application/x-neutrino-slide';
const DIAGRAM_MIME = 'application/x-neutrino-diagram';
const DRAWING_MIME = 'application/x-neutrino-drawing';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function makeRouter() {
  return { push: vi.fn() };
}

function makeOpts(officeInPlaceEditingEnabled: boolean) {
  return {
    officeInPlaceEditingEnabled,
    onPreviewFallback: vi.fn(),
  };
}

describe('routeForFile — native mimetypes (unchanged regardless of office flag)', () => {
  it.each([
    ['doc', DOC_MIME, '/docs/editor?id='],
    ['sheet', SHEET_MIME, '/sheets/editor?id='],
    ['slide', SLIDES_MIME, '/slides/editor?id='],
    ['diagram', DIAGRAM_MIME, '/diagrams/editor?id='],
    ['drawing', DRAWING_MIME, '/drawing/editor?id='],
  ])('routes a native %s file to its editor', (_label, mimeType, expectedPrefix) => {
    const router = makeRouter();
    const opts = makeOpts(true);
    routeForFile({ id: 'file-1', mimeType, name: 'Item' }, router, opts);
    expect(router.push).toHaveBeenCalledWith(`${expectedPrefix}file-1`);
    expect(opts.onPreviewFallback).not.toHaveBeenCalled();
  });

  it('routes native files the same way when the office flag is off', () => {
    const router = makeRouter();
    const opts = makeOpts(false);
    routeForFile({ id: 'file-2', mimeType: DOC_MIME, name: 'Item' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/docs/editor?id=file-2');
  });
});

describe('routeForFile — office formats, flag ON', () => {
  it('routes a .docx file to the docs editor', () => {
    const router = makeRouter();
    const opts = makeOpts(true);
    routeForFile({ id: 'file-3', mimeType: DOCX_MIME, name: 'report.docx' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/docs/editor?id=file-3');
    expect(opts.onPreviewFallback).not.toHaveBeenCalled();
  });

  it('routes a .xlsx file to the sheets editor', () => {
    const router = makeRouter();
    const opts = makeOpts(true);
    routeForFile({ id: 'file-4', mimeType: XLSX_MIME, name: 'budget.xlsx' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/sheets/editor?id=file-4');
  });

  it('routes a .pptx file to the slides editor', () => {
    const router = makeRouter();
    const opts = makeOpts(true);
    routeForFile({ id: 'file-5', mimeType: PPTX_MIME, name: 'deck.pptx' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/slides/editor?id=file-5');
  });

  it('detects office format via extension fallback when mimetype is octet-stream', () => {
    const router = makeRouter();
    const opts = makeOpts(true);
    routeForFile(
      { id: 'file-6', mimeType: 'application/octet-stream', name: 'report.docx' },
      router,
      opts
    );
    expect(router.push).toHaveBeenCalledWith('/docs/editor?id=file-6');
  });
});

describe('routeForFile — office formats, flag OFF', () => {
  it('does NOT route a .docx file into the docs editor when the flag is off', () => {
    const router = makeRouter();
    const opts = makeOpts(false);
    routeForFile({ id: 'file-7', mimeType: DOCX_MIME, name: 'report.docx' }, router, opts);
    expect(router.push).not.toHaveBeenCalled();
    expect(opts.onPreviewFallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-7' })
    );
  });
});

describe('routeForFile — legacy formats are never treated as office files', () => {
  it.each([
    ['doc', 'application/msword', 'legacy.doc'],
    ['xls', 'application/vnd.ms-excel', 'legacy.xls'],
    ['ppt', 'application/vnd.ms-powerpoint', 'legacy.ppt'],
  ])('falls through to preview for legacy .%s files even with the office flag on', (_label, mimeType, name) => {
    const router = makeRouter();
    const opts = makeOpts(true);
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
    const opts = makeOpts(true);
    routeForFile({ id: 'file-9', mimeType: 'image/png', name: 'photo.png' }, router, opts);
    expect(router.push).toHaveBeenCalledWith('/photos/editor?fileId=file-9');
  });

  it('calls onPreviewFallback for an unrelated file type', () => {
    const router = makeRouter();
    const opts = makeOpts(true);
    const file = { id: 'file-10', mimeType: 'application/pdf', name: 'invoice.pdf' };
    routeForFile(file, router, opts);
    expect(router.push).not.toHaveBeenCalled();
    expect(opts.onPreviewFallback).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-10' }));
  });
});
