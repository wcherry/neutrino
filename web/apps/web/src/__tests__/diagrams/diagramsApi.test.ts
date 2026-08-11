/**
 * Tests for the diagrams API client.
 *
 * A diagram is a Drive file with the native diagram mime type, so these assert
 * the drive endpoints the client now translates to — and, just as importantly,
 * that the diagram-shaped response its callers expect survives the translation
 * from drive's file DTOs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  contentVersionQuery: () => '',
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

import { request, ApiClientError } from '@neutrino/api-core';
import { diagramsApi, DIAGRAM_MIME_TYPE } from '../../app/(apps)/diagrams/api';

const mockRequest = request as ReturnType<typeof vi.fn>;

/** A drive file DTO as the backend returns it — note the naive timestamps. */
const fakeDriveFile = {
  id: 'diag-1',
  name: 'My Diagram',
  folderId: null,
  mimeType: DIAGRAM_MIME_TYPE,
  createdAt: '2026-06-08T00:00:00',
  updatedAt: '2026-06-08T00:00:00',
  contentVersion: 3,
};

beforeEach(() => {
  mockRequest.mockReset();
});

describe('diagramsApi.createDiagram', () => {
  it('POSTs a drive file record carrying the native diagram mime type', async () => {
    mockRequest.mockResolvedValue(fakeDriveFile);
    const result = await diagramsApi.createDiagram({ title: 'My Diagram' });

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/drive/files',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockRequest.mock.calls[0][1].body);
    expect(body.mimeType).toBe(DIAGRAM_MIME_TYPE);
    expect(body.name).toBe('My Diagram');
    // Drive requires a client-generated id so the caller can navigate straight
    // to the editor without waiting for the response.
    expect(body.id).toEqual(expect.any(String));
    expect(result.id).toBe('diag-1');
    expect(result.title).toBe('My Diagram');
  });

  it('includes folderId when provided', async () => {
    mockRequest.mockResolvedValue({ ...fakeDriveFile, folderId: 'folder-1' });
    await diagramsApi.createDiagram({ title: 'My Diagram', folderId: 'folder-1' });
    const body = JSON.parse(mockRequest.mock.calls[0][1].body);
    expect(body.folderId).toBe('folder-1');
  });

  it('rejects a blank title without issuing a request', async () => {
    await expect(diagramsApi.createDiagram({ title: '   ' })).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('diagramsApi.getDiagram', () => {
  it('reads the drive file info endpoint and maps it to a diagram', async () => {
    mockRequest.mockResolvedValue(fakeDriveFile);
    const result = await diagramsApi.getDiagram('diag-1');

    expect(mockRequest).toHaveBeenCalledWith('/api/v1/drive/files/diag-1/info');
    expect(result.contentUrl).toBe('/api/v1/drive/files/diag-1');
    expect(result.contentWriteUrl).toBe('/api/v1/drive/files/diag-1/versions');
    expect(result.contentVersion).toBe(3);
  });

  /**
   * Drive's /info answers for any file type, so the client is what decides a
   * file is not a diagram. Without this the editor would open a PDF as a blank
   * canvas rather than reporting it missing.
   */
  it('404s for a file that exists but is not a native diagram', async () => {
    mockRequest.mockResolvedValue({ ...fakeDriveFile, mimeType: 'application/pdf' });

    await expect(diagramsApi.getDiagram('diag-1')).rejects.toMatchObject({ statusCode: 404 });
    expect(ApiClientError).toBeDefined();
  });

  /**
   * Drive serialises naive datetimes. Passed through unchanged, `new Date()`
   * would read them as local time and shift every displayed timestamp by the
   * viewer's UTC offset.
   */
  it('marks drive timestamps as UTC', async () => {
    mockRequest.mockResolvedValue(fakeDriveFile);
    const result = await diagramsApi.getDiagram('diag-1');
    expect(result.updatedAt).toBe('2026-06-08T00:00:00Z');
  });

  it('leaves an already-zoned timestamp alone', async () => {
    mockRequest.mockResolvedValue({ ...fakeDriveFile, updatedAt: '2026-06-08T00:00:00Z' });
    const result = await diagramsApi.getDiagram('diag-1');
    expect(result.updatedAt).toBe('2026-06-08T00:00:00Z');
  });
});

describe('diagramsApi.saveDiagram', () => {
  it('renames the backing drive file', async () => {
    mockRequest.mockResolvedValue({ ...fakeDriveFile, name: 'New Title' });
    const result = await diagramsApi.saveDiagram('diag-1', { title: 'New Title' });

    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/drive/files/diag-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(JSON.parse(mockRequest.mock.calls[0][1].body)).toEqual({ name: 'New Title' });
    expect(result.title).toBe('New Title');
  });
});

describe('diagramsApi.listDiagrams', () => {
  it('lists drive files filtered to the native diagram mime type', async () => {
    mockRequest.mockResolvedValue({ files: [fakeDriveFile] });
    const result = await diagramsApi.listDiagrams();

    const url = mockRequest.mock.calls[0][0] as string;
    expect(url.startsWith('/api/v1/drive/files?')).toBe(true);
    expect(decodeURIComponent(url)).toContain(`mimeType=${DIAGRAM_MIME_TYPE}`);
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0].id).toBe('diag-1');
    expect(result.diagrams[0].title).toBe('My Diagram');
  });

  it('tolerates a response with no files array', async () => {
    mockRequest.mockResolvedValue({});
    const result = await diagramsApi.listDiagrams();
    expect(result.diagrams).toEqual([]);
  });
});

describe('diagramsApi.deleteDiagram', () => {
  it('trashes the backing drive file', async () => {
    mockRequest.mockResolvedValue(undefined);
    await diagramsApi.deleteDiagram('diag-1');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/drive/files/diag-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
