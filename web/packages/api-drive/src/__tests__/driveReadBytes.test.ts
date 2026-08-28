/**
 * `driveReadBytes` and the brand-new office document.
 *
 * `driveReadContent`'s counterpart for the OOXML editors, and it exists for the
 * same reason one layer down. A `.docx`, `.xlsx` or `.pptx` is a zip, so
 * `createDoc`/`createSheet`/`createSlide` insert the Drive row with no body at
 * all — the server cannot build a package, and could only write one in the
 * clear. Its `storage_path` stays empty until the first save, and the download
 * endpoint answers an empty path with 409 `NO_CONTENT`.
 *
 * Each office-mode reader already had a "zero bytes: open the blank default and
 * let the first save write a real package" branch, but the 409 threw before any
 * of them could reach it, so creating a document ended on "Failed to open this
 * file for editing". `CONTENT_MISSING` — the row outliving its blob — is a real
 * fault and must still reject, exactly as in `driveReadContent`.
 *
 * Mocking convention follows `driveReadContent.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  ApiClientError: class ApiClientError extends Error {
    constructor(public statusCode: number, public code: string, message: string) {
      super(message);
      this.name = 'ApiClientError';
    }
  },
  BASE_URL: '',
  buildQuery: () => '',
  contentVersionQuery: () => '',
}));

import { request, ApiClientError } from '@neutrino/api-core';
import { driveReadBytes } from '../client';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('driveReadBytes', () => {
  it('returns the stored bytes for a file that has content', async () => {
    // The first four bytes of any zip, which is what a real .docx arrives as.
    const stored = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    mockRequest.mockResolvedValue(new Blob([stored]));

    await expect(driveReadBytes('f1')).resolves.toEqual(stored);
  });

  it('reads a never-written file as zero bytes rather than throwing', async () => {
    mockRequest.mockRejectedValue(
      new ApiClientError(409, 'NO_CONTENT', 'File has no uploaded content'),
    );

    const bytes = await driveReadBytes('new-doc');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(0);
  });

  it('still throws when the row outlived its blob', async () => {
    mockRequest.mockRejectedValue(
      new ApiClientError(409, 'CONTENT_MISSING', 'File content is missing from storage'),
    );

    await expect(driveReadBytes('orphan')).rejects.toMatchObject({
      code: 'CONTENT_MISSING',
    });
  });

  it('does not swallow unrelated failures', async () => {
    mockRequest.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN', 'No access'));

    await expect(driveReadBytes('theirs')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reads the download endpoint for the file it is given', async () => {
    mockRequest.mockResolvedValue(new Blob([new Uint8Array([1])]));

    await driveReadBytes('file-42');

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/drive/files/file-42',
      {},
      expect.objectContaining({ responseType: 'blob' }),
    );
  });
});
