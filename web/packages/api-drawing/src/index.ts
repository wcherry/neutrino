import { request, contentVersionQuery, ApiClientError, type ContentVersionCheck } from '@neutrino/api-core';

/**
 * A file is a native Neutrino drawing because it carries this mime type.
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const DRAWING_MIME_TYPE = 'application/x-neutrino-drawing';

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
  /**
   * Server-side content revision at load time. The editor sends it back as
   * `expectedContentVersion` on its first save, so a document changed by
   * another device since it was opened is caught immediately.
   */
  contentVersion: number;
}

export interface DrawingMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Server-side content revision, bumped on every content write. Pass it back as
   * `expectedContentVersion` on the next save so a stale write is rejected
   * rather than silently overwriting a newer revision.
   */
  contentVersion: number;
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

// ---------------------------------------------------------------------------
// Drawing API — drive adapters
// ---------------------------------------------------------------------------
//
// A drawing is nothing but a Drive file whose mime type is
// `application/x-neutrino-drawing` — it has no state of its own, so unlike the
// other editors there is no drawing module left on the backend at all. These
// functions keep the drawing-shaped contract their callers were written
// against and translate it to and from drive's file DTOs.

/** The subset of drive's file DTOs these adapters read. */
interface DriveFileDto {
  id: string;
  name: string;
  folderId: string | null;
  mimeType?: string | null;
  createdAt: string;
  updatedAt: string;
  contentVersion: number;
}

/**
 * Drive serialises timestamps as naive datetimes (`2026-08-10T12:00:00`) — no
 * offset — which `new Date()` would read as local time and shift by the
 * viewer's UTC offset. The values are UTC, so say so.
 */
function toIsoUtc(timestamp: string): string {
  if (!timestamp) return timestamp;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
}

function toDrawingMeta(file: DriveFileDto): DrawingMetaResponse {
  return {
    id: file.id,
    title: file.name,
    folderId: file.folderId ?? null,
    createdAt: toIsoUtc(file.createdAt),
    updatedAt: toIsoUtc(file.updatedAt),
    contentVersion: file.contentVersion,
  };
}

function toDrawing(file: DriveFileDto): DrawingResponse {
  return {
    ...toDrawingMeta(file),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
  };
}

export const drawingApi = {
  async listDrawings(): Promise<ListDrawingsResponse> {
    const params = new URLSearchParams({ mimeType: DRAWING_MIME_TYPE, limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { drawings: (raw.files ?? []).map(toDrawingMeta) };
  },

  async createDrawing(body: CreateDrawingRequest): Promise<DrawingResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Drawing title cannot be empty');
    // Drive takes a client-supplied id and seeds the empty-canvas body from the
    // mime type, so create and first content write are one request.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: title,
        mimeType: DRAWING_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    return toDrawing(file);
  },

  async getDrawing(drawingId: string): Promise<DrawingResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${drawingId}/info`);
    if (file.mimeType !== DRAWING_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Drawing not found');
    }
    return toDrawing(file);
  },

  async saveDrawing(drawingId: string, body: SaveDrawingRequest): Promise<DrawingMetaResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${drawingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: body.title }),
    });
    return toDrawingMeta(file);
  },

  async autosaveContent(
    drawingId: string,
    content: string,
    filename: string,
    metadata?: { title?: string },
    versionCheck?: ContentVersionCheck,
  ): Promise<DrawingMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    const file = await request<DriveFileDto>(
      `/api/v1/drive/files/${drawingId}/autosave${contentVersionQuery(versionCheck)}`,
      { method: 'PUT', body: formData },
    );
    return toDrawingMeta(file);
  },
};
