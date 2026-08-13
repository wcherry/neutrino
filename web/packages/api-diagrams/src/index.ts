import { request, contentVersionQuery, ApiClientError, type ContentVersionCheck } from '@neutrino/api-core';

/**
 * A file is a native Neutrino diagram because it carries this mime type.
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const DIAGRAM_MIME_TYPE = 'application/x-neutrino-diagram';

// ---------------------------------------------------------------------------
// Diagram text extraction helpers
// ---------------------------------------------------------------------------

type DiagramShapeContent = { label?: string };
type DiagramConnectorContent = { label?: string };
type DiagramPageContent = {
  name?: string;
  shapes?: DiagramShapeContent[];
  connectors?: DiagramConnectorContent[];
};
type DiagramFileContent = { pages?: DiagramPageContent[] };

/**
 * Flatten a stored diagram body into searchable plain text — page names plus
 * every shape and connector label.
 *
 * Takes the already-decrypted body rather than fetching it: diagram content is
 * E2EE, so only the caller holds the DEK needed to read it (see
 * `readDocumentText` in the web app).
 */
export function extractDiagramText(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as DiagramFileContent;
    const parts: string[] = [];
    for (const page of parsed.pages ?? []) {
      if (page.name) parts.push(page.name);
      for (const shape of page.shapes ?? []) {
        if (shape.label) parts.push(shape.label);
      }
      for (const connector of page.connectors ?? []) {
        if (connector.label) parts.push(connector.label);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Diagram types
// ---------------------------------------------------------------------------

export interface DiagramResponse {
  id: string;
  title: string;
  /** Path to read diagram content directly from the drive API (GET). */
  contentUrl: string;
  /** Path to write diagram content directly to the drive API (multipart PUT). */
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

export interface DiagramMetaResponse {
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

export interface CreateDiagramRequest {
  title: string;
  folderId?: string | null;
}

export interface SaveDiagramRequest {
  title?: string;
}

export interface ListDiagramsResponse {
  diagrams: DiagramMetaResponse[];
}

// ---------------------------------------------------------------------------
// Comment types
// ---------------------------------------------------------------------------

export interface DiagramComment {
  id: string;
  fileId: string;
  userId: string;
  content: string;
  parentId: string | null;
  shapeId: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentRequest {
  content: string;
  parentId?: string | null;
  shapeId?: string | null;
}

export interface UpdateCommentRequest {
  content?: string;
  resolved?: boolean;
}

export interface ListCommentsResponse {
  comments: DiagramComment[];
}

// ---------------------------------------------------------------------------
// Diagrams API — drive adapters
// ---------------------------------------------------------------------------
//
// Diagram CRUD is served by the generic drive file endpoints; a diagram is a
// Drive file whose mime type is `application/x-neutrino-diagram`. These
// functions keep the diagram-shaped contract their callers were written
// against and translate it to and from drive's file DTOs. Comments below hang
// off the file and have no Drive equivalent, so they keep their own endpoints.

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

function toDiagramMeta(file: DriveFileDto): DiagramMetaResponse {
  return {
    id: file.id,
    title: file.name,
    folderId: file.folderId ?? null,
    createdAt: toIsoUtc(file.createdAt),
    updatedAt: toIsoUtc(file.updatedAt),
    contentVersion: file.contentVersion,
  };
}

function toDiagram(file: DriveFileDto): DiagramResponse {
  return {
    ...toDiagramMeta(file),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
  };
}

export const diagramsApi = {
  async listDiagrams(): Promise<ListDiagramsResponse> {
    const params = new URLSearchParams({ mimeType: DIAGRAM_MIME_TYPE, limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { diagrams: (raw.files ?? []).map(toDiagramMeta) };
  },

  async createDiagram(body: CreateDiagramRequest): Promise<DiagramResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Diagram title cannot be empty');
    // Drive takes a client-supplied id and seeds the blank-page body from the
    // mime type, so create and first content write are one request.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: title,
        mimeType: DIAGRAM_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    return toDiagram(file);
  },

  async getDiagram(diagramId: string): Promise<DiagramResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${diagramId}/info`);
    if (file.mimeType !== DIAGRAM_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Diagram not found');
    }
    return toDiagram(file);
  },

  async saveDiagram(diagramId: string, body: SaveDiagramRequest): Promise<DiagramMetaResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${diagramId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: body.title }),
    });
    return toDiagramMeta(file);
  },

  async deleteDiagram(diagramId: string): Promise<void> {
    await request<void>(`/api/v1/drive/files/${diagramId}`, { method: 'DELETE' });
  },

  async autosaveContent(
    diagramId: string,
    content: string,
    filename: string,
    metadata?: { title?: string },
    versionCheck?: ContentVersionCheck,
  ): Promise<DiagramMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    const file = await request<DriveFileDto>(
      `/api/v1/drive/files/${diagramId}/autosave${contentVersionQuery(versionCheck)}`,
      { method: 'PUT', body: formData },
    );
    return toDiagramMeta(file);
  },

  async autosaveEncryptedContent(
    diagramId: string,
    content: string,
    filename: string,
    dek: Uint8Array,
    metadata?: { title?: string },
    versionCheck?: ContentVersionCheck,
  ): Promise<DiagramMetaResponse> {
    const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
    await initSodium();
    const plainBytes = new TextEncoder().encode(content);
    const cipherBytes = encryptFile(plainBytes, dek);
    const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    const file = await request<DriveFileDto>(
      `/api/v1/drive/files/${diagramId}/autosave${contentVersionQuery(versionCheck)}`,
      { method: 'PUT', body: formData },
    );
    return toDiagramMeta(file);
  },

  // ── Comments ───────────────────────────────────────────────────────────────

  async listComments(diagramId: string): Promise<ListCommentsResponse> {
    return request<ListCommentsResponse>(`/api/v1/diagrams/${diagramId}/comments`);
  },

  async createComment(diagramId: string, body: CreateCommentRequest): Promise<DiagramComment> {
    return request<DiagramComment>(`/api/v1/diagrams/${diagramId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateComment(
    diagramId: string,
    commentId: string,
    body: UpdateCommentRequest,
  ): Promise<DiagramComment> {
    return request<DiagramComment>(`/api/v1/diagrams/${diagramId}/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteComment(diagramId: string, commentId: string): Promise<void> {
    await request<void>(`/api/v1/diagrams/${diagramId}/comments/${commentId}`, {
      method: 'DELETE',
    });
  },
};
