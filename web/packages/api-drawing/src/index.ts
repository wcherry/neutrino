import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Drawing text extraction helpers
// ---------------------------------------------------------------------------

type DrawingShapeContent = { text?: string };
type DrawingFileContent = { shapes?: DrawingShapeContent[] };

/**
 * Flatten a stored drawing body into searchable plain text — the text carried
 * by each shape. Freehand strokes contribute nothing.
 *
 * Takes the already-decrypted body rather than fetching it: drawing content is
 * E2EE, so only the caller holds the DEK needed to read it (see
 * `readDocumentText` in the web app).
 */
export function extractDrawingText(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as DrawingFileContent;
    const parts: string[] = [];
    for (const shape of parsed.shapes ?? []) {
      if (shape.text) parts.push(shape.text);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export interface DrawingResponse {
  id: string;
  title: string;
  contentUrl: string;
  contentWriteUrl: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DrawingMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDrawingRequest {
  title: string;
  folderId?: string | null;
}

export interface SaveDrawingRequest {
  title?: string;
}

export interface ListDrawingsResponse {
  drawings: DrawingMetaResponse[];
}

export const drawingApi = {
  async listDrawings(): Promise<ListDrawingsResponse> {
    return request<ListDrawingsResponse>('/api/v1/drawing');
  },

  async createDrawing(body: CreateDrawingRequest): Promise<DrawingResponse> {
    return request<DrawingResponse>('/api/v1/drawing', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getDrawing(drawingId: string): Promise<DrawingResponse> {
    return request<DrawingResponse>(`/api/v1/drawing/${drawingId}`);
  },

  async saveDrawing(drawingId: string, body: SaveDrawingRequest): Promise<DrawingMetaResponse> {
    return request<DrawingMetaResponse>(`/api/v1/drawing/${drawingId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async autosaveContent(
    drawingId: string,
    content: string,
    filename: string,
    metadata?: { title?: string },
  ): Promise<DrawingMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<DrawingMetaResponse>(`/api/v1/drawing/${drawingId}/autosave`, {
      method: 'PUT',
      body: formData,
    });
  },
};
