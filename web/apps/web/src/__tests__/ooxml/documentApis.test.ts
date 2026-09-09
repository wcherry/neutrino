/**
 * What Docs, Sheets and Slides create, list and rename since issue #127.
 *
 * These three adapters are the seam where the format change is actually
 * decided: a new document is a `.docx`/`.xlsx`/`.pptx` Drive file, and the
 * title the UI passes around has no extension on it. The bespoke JSON that
 * predated OOXML held no files and is gone, so there is one format each.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequest = vi.fn();

vi.mock('@neutrino/api-core', async (importOriginal) => ({
  // Partial mock: the format helpers are pure and are what these adapters are
  // being tested on. Only the HTTP call is stubbed.
  ...(await importOriginal<typeof import('@neutrino/api-core')>()),
  request: (...args: unknown[]) => mockRequest(...args),
}));

import { docsApi, DOCX_MIME_TYPE } from '@neutrino/api-docs';
import { sheetsApi, XLSX_MIME_TYPE } from '@neutrino/api-sheets';
import { slidesApi, PPTX_MIME_TYPE } from '@neutrino/api-slides';

function driveFile(over: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    name: 'Report.docx',
    folderId: null,
    mimeType: DOCX_MIME_TYPE,
    createdAt: '2026-08-25T10:00:00',
    updatedAt: '2026-08-25T10:00:00',
    contentVersion: 1,
    ...over,
  };
}

/** The body of the last POST/PATCH, parsed. */
function lastBody(): Record<string, unknown> {
  const [, init] = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
  return JSON.parse((init as { body: string }).body);
}

beforeEach(() => {
  mockRequest.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => 'generated-id' });
});

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

describe('creating a document', () => {
  it('creates a Word document, named with its extension', async () => {
    mockRequest.mockResolvedValue(driveFile());

    await docsApi.createDoc({ title: 'Report' });

    const body = lastBody();
    expect(body.mimeType).toBe(DOCX_MIME_TYPE);
    // The name is what lands on disk on download; a Word file called "Report"
    // is one the operating system will not open.
    expect(body.name).toBe('Report.docx');
  });

  it('creates an Excel workbook for a new spreadsheet', async () => {
    mockRequest.mockResolvedValue(driveFile({ name: 'Budget.xlsx', mimeType: XLSX_MIME_TYPE }));

    await sheetsApi.createSheet({ title: 'Budget' });

    expect(lastBody()).toMatchObject({ mimeType: XLSX_MIME_TYPE, name: 'Budget.xlsx' });
  });

  it('creates a PowerPoint deck for a new presentation', async () => {
    mockRequest.mockResolvedValue(driveFile({ name: 'Kickoff.pptx', mimeType: PPTX_MIME_TYPE }));

    await slidesApi.createSlide({ title: 'Kickoff' });

    expect(lastBody()).toMatchObject({ mimeType: PPTX_MIME_TYPE, name: 'Kickoff.pptx' });
  });

  /**
   * Deliberately no `initialContent`. The bespoke-JSON types are seeded
   * server-side from `native_types`, but an OOXML package is a zip the server
   * has no business building — and could only write in the clear anyway. The
   * editor's first save is both the seed and the sealing.
   */
  it('sends no body for the server to seed', async () => {
    mockRequest.mockResolvedValue(driveFile());

    await docsApi.createDoc({ title: 'Report' });

    expect(lastBody()).not.toHaveProperty('initialContent');
  });

  it('reports the created document under its title, without the extension', async () => {
    mockRequest.mockResolvedValue(driveFile());

    const created = await docsApi.createDoc({ title: 'Report' });

    expect(created.title).toBe('Report');
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe('listing a library', () => {
  it('asks for the OOXML format', async () => {
    mockRequest.mockResolvedValue({ files: [] });

    await docsApi.listDocs();

    const [url] = mockRequest.mock.calls[0] as [string];
    const mimeType = new URLSearchParams(url.split('?')[1]).get('mimeType');
    expect(mimeType?.split(',')).toEqual([DOCX_MIME_TYPE]);
  });

  it.each([
    ['sheets', () => sheetsApi.listSheets(), [XLSX_MIME_TYPE]],
    ['slides', () => slidesApi.listSlides(), [PPTX_MIME_TYPE]],
  ] as const)('asks for the %s format too', async (_label, call, expected) => {
    mockRequest.mockResolvedValue({ files: [] });

    await call();

    const [url] = mockRequest.mock.calls[0] as [string];
    const mimeType = new URLSearchParams(url.split('?')[1]).get('mimeType');
    expect(mimeType?.split(',')).toEqual([...expected]);
  });

  it('lists a .docx under its title rather than its filename', async () => {
    mockRequest.mockResolvedValue({ files: [driveFile()] });

    const { docs } = await docsApi.listDocs();

    expect(docs[0].title).toBe('Report');
  });

});

// ---------------------------------------------------------------------------
// Renaming
// ---------------------------------------------------------------------------

describe('renaming', () => {
  it('puts the extension back on when the file is a .docx', async () => {
    mockRequest
      .mockResolvedValueOnce(driveFile())
      .mockResolvedValueOnce(driveFile({ name: 'Q3 review.docx' }));

    await docsApi.saveDoc('file-1', { title: 'Q3 review' });

    expect(lastBody()).toEqual({ name: 'Q3 review.docx' });
  });

  it('does not write when the name would not change', async () => {
    mockRequest.mockResolvedValue(driveFile());

    await docsApi.saveDoc('file-1', { title: 'Report' });

    // One call: the read. Renaming to the name it already has is what a title
    // field fires on every blur.
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('degrades to a metadata read with no title, as callers after contentVersion rely on', async () => {
    mockRequest.mockResolvedValue(driveFile({ contentVersion: 7 }));

    const meta = await docsApi.saveDoc('file-1', {});

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(meta.contentVersion).toBe(7);
  });

  it('renames a spreadsheet back to .xlsx', async () => {
    mockRequest
      .mockResolvedValueOnce(driveFile({ name: 'Budget.xlsx', mimeType: XLSX_MIME_TYPE }))
      .mockResolvedValueOnce(driveFile({ name: 'Q1 budget.xlsx', mimeType: XLSX_MIME_TYPE }));

    await sheetsApi.saveSheet('file-1', { title: 'Q1 budget' });

    expect(lastBody()).toEqual({ name: 'Q1 budget.xlsx' });
  });

  it('renames a presentation back to .pptx', async () => {
    mockRequest
      .mockResolvedValueOnce(driveFile({ name: 'Kickoff.pptx', mimeType: PPTX_MIME_TYPE }))
      .mockResolvedValueOnce(driveFile({ name: 'Launch.pptx', mimeType: PPTX_MIME_TYPE }));

    await slidesApi.saveSlide('file-1', { title: 'Launch' });

    expect(lastBody()).toEqual({ name: 'Launch.pptx' });
  });
});
