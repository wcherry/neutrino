import { request } from '@neutrino/api-core';

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
}

export interface DiagramMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
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
// Diagrams API
// ---------------------------------------------------------------------------

export const diagramsApi = {
  async listDiagrams(): Promise<ListDiagramsResponse> {
    return request<ListDiagramsResponse>('/api/v1/diagrams');
  },

  async createDiagram(body: CreateDiagramRequest): Promise<DiagramResponse> {
    return request<DiagramResponse>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getDiagram(diagramId: string): Promise<DiagramResponse> {
    return request<DiagramResponse>(`/api/v1/diagrams/${diagramId}`);
  },

  async saveDiagram(diagramId: string, body: SaveDiagramRequest): Promise<DiagramMetaResponse> {
    return request<DiagramMetaResponse>(`/api/v1/diagrams/${diagramId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteDiagram(diagramId: string): Promise<void> {
    await request<void>(`/api/v1/diagrams/${diagramId}`, { method: 'DELETE' });
  },

  async autosaveContent(
    diagramId: string,
    content: string,
    filename: string,
    metadata?: { title?: string },
  ): Promise<DiagramMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<DiagramMetaResponse>(`/api/v1/diagrams/${diagramId}/autosave`, {
      method: 'PUT',
      body: formData,
    });
  },

  async autosaveEncryptedContent(
    diagramId: string,
    content: string,
    filename: string,
    dek: Uint8Array,
    metadata?: { title?: string },
  ): Promise<DiagramMetaResponse> {
    const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
    await initSodium();
    const plainBytes = new TextEncoder().encode(content);
    const cipherBytes = encryptFile(plainBytes, dek);
    const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<DiagramMetaResponse>(`/api/v1/diagrams/${diagramId}/autosave`, {
      method: 'PUT',
      body: formData,
    });
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
