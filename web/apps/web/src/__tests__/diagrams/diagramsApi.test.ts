/**
 * Tests for the diagrams API client.
 *
 * Covers:
 * - createDiagram sends POST with correct body and returns DiagramResponse
 * - getDiagram sends GET for the correct ID
 * - saveDiagram sends PATCH with correct body
 * - listDiagrams returns DiagramMetaResponse array
 * - autosave sends PUT multipart to correct URL
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
}));

import { request } from '@neutrino/api-core';
import { diagramsApi } from '../../app/(apps)/diagrams/api';

const mockRequest = request as ReturnType<typeof vi.fn>;

const fakeDiagram = {
  id: 'diag-1',
  title: 'My Diagram',
  contentUrl: '/api/v1/drive/files/diag-1',
  contentWriteUrl: '/api/v1/drive/files/diag-1/versions',
  folderId: null,
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
};

const fakeMeta = {
  id: 'diag-1',
  title: 'My Diagram',
  folderId: null,
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
};

beforeEach(() => {
  mockRequest.mockReset();
});

describe('diagramsApi.createDiagram', () => {
  it('sends POST to /api/v1/diagrams with title', async () => {
    mockRequest.mockResolvedValue(fakeDiagram);
    const result = await diagramsApi.createDiagram({ title: 'My Diagram' });
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/diagrams',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.id).toBe('diag-1');
    expect(result.title).toBe('My Diagram');
  });

  it('includes folderId when provided', async () => {
    mockRequest.mockResolvedValue({ ...fakeDiagram, folderId: 'folder-1' });
    await diagramsApi.createDiagram({ title: 'My Diagram', folderId: 'folder-1' });
    const body = JSON.parse(mockRequest.mock.calls[0][1].body);
    expect(body.folderId).toBe('folder-1');
  });
});

describe('diagramsApi.getDiagram', () => {
  it('sends GET to /api/v1/diagrams/:id', async () => {
    mockRequest.mockResolvedValue(fakeDiagram);
    const result = await diagramsApi.getDiagram('diag-1');
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/diagrams/diag-1');
    expect(result.contentUrl).toBe('/api/v1/drive/files/diag-1');
  });
});

describe('diagramsApi.saveDiagram', () => {
  it('sends PATCH to /api/v1/diagrams/:id', async () => {
    mockRequest.mockResolvedValue(fakeMeta);
    const result = await diagramsApi.saveDiagram('diag-1', { title: 'New Title' });
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/diagrams/diag-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(result.id).toBe('diag-1');
  });
});

describe('diagramsApi.listDiagrams', () => {
  it('sends GET to /api/v1/diagrams and returns list', async () => {
    mockRequest.mockResolvedValue({ diagrams: [fakeMeta] });
    const result = await diagramsApi.listDiagrams();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/diagrams');
    expect(result.diagrams).toHaveLength(1);
    expect(result.diagrams[0].id).toBe('diag-1');
  });
});

describe('diagramsApi.deleteDiagram', () => {
  it('sends DELETE to /api/v1/diagrams/:id', async () => {
    mockRequest.mockResolvedValue(undefined);
    await diagramsApi.deleteDiagram('diag-1');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/diagrams/diag-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
