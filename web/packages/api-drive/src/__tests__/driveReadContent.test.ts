/**
 * `driveReadContent` and the empty-document case.
 *
 * A Drive file whose content has never been written answers the content
 * endpoint with 409 `NO_CONTENT` (see `no_content_error` in
 * `src/drive/storage/service.rs`). That is the normal state of a document
 * between being created and being saved for the first time: `createNote`
 * inserts the row with no body, and only the sheet/doc/slide/drawing/diagram
 * mime types get a default body seeded server-side by `native_types.rs`.
 *
 * Letting that 409 reject made opening a brand-new note an error the editor
 * retried and then sat on, never leaving its loading state — so the note could
 * not be typed into at all. `CONTENT_MISSING`, which means the row outlived its
 * blob, is a real fault and must still reject; keeping the two apart is why the
 * server has separate codes for them.
 *
 * Mocking convention follows `binaryBytes.test.ts`.
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
import { driveReadContent } from '../client';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('driveReadContent', () => {
  it('returns the stored text for a file that has content', async () => {
    mockRequest.mockResolvedValue('[{"type":"paragraph","content":"hello"}]');

    await expect(driveReadContent('/api/v1/drive/files/f1')).resolves.toBe(
      '[{"type":"paragraph","content":"hello"}]',
    );
  });

  it('reads a never-written file as empty rather than throwing', async () => {
    mockRequest.mockRejectedValue(
      new ApiClientError(409, 'NO_CONTENT', 'File has no uploaded content'),
    );

    await expect(driveReadContent('/api/v1/drive/files/new-note')).resolves.toBe('');
  });

  it('still throws when the row outlived its blob', async () => {
    // Distinct from NO_CONTENT on purpose: bytes were expected and are gone,
    // which no amount of retrying fixes and the editor must not paper over.
    mockRequest.mockRejectedValue(
      new ApiClientError(409, 'CONTENT_MISSING', 'File content is missing from storage'),
    );

    await expect(driveReadContent('/api/v1/drive/files/orphan')).rejects.toMatchObject({
      code: 'CONTENT_MISSING',
    });
  });

  it('does not swallow unrelated failures', async () => {
    mockRequest.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN', 'No access'));

    await expect(driveReadContent('/api/v1/drive/files/theirs')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
