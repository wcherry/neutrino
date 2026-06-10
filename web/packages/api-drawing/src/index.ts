import { request } from '@neutrino/api-core';

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
