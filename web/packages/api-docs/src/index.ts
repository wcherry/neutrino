import { request, contentVersionQuery, type ContentVersionCheck } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Tiptap text extraction (client-side, no tiptap dependency required)
// ---------------------------------------------------------------------------

type TiptapNode = { type: string; text?: string; content?: TiptapNode[] };

/**
 * With the `docsLayoutStructure` flag on, `serializeContent` in `DocEditor`
 * wraps the Tiptap JSON as `{ doc, _meta }` so header/footer/watermark settings
 * survive a round-trip. Older documents — and any saved with the flag off — are
 * bare Tiptap JSON.
 */
type StoredDoc = TiptapNode | { doc: TiptapNode; _meta?: unknown };

function tiptapToText(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  return (node.content ?? []).map(tiptapToText).join(' ');
}

/**
 * Flatten a stored `doc.json` body into searchable plain text.
 *
 * Takes the already-decrypted document rather than fetching it: doc bodies are
 * E2EE, so only the caller holds the DEK needed to read them (see
 * `readDocumentText` in the web app).
 */
export function extractDocText(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as StoredDoc;
    // Unwrap the layout envelope. Missing this indexes the whole document as
    // empty: the wrapper has neither `type` nor `content`, so the walk below
    // finds nothing and returns '' for a document full of text.
    const root = 'doc' in parsed && parsed.doc ? parsed.doc : (parsed as TiptapNode);
    return tiptapToText(root).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Docs types
// ---------------------------------------------------------------------------

export interface PageSetup {
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  orientation: 'portrait' | 'landscape';
  pageSize: 'letter' | 'a4' | 'legal' | 'a3' | 'a5' | 'tabloid' | 'executive';
}

export interface DocResponse {
  id: string;
  title: string;
  /** Path to read document content directly from the drive API (GET). */
  contentUrl: string;
  /** Path to write document content directly to the drive API (multipart POST). */
  contentWriteUrl: string;
  pageSetup: PageSetup;
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

export interface DocMetaResponse {
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

export interface CreateDocRequest {
  title: string;
  folderId?: string | null;
}

export interface SaveDocRequest {
  pageSetup?: PageSetup;
  title?: string;
}

export interface ExportTextResponse {
  text: string;
  wordCount: number;
  charCount: number;
}

export interface ListDocsResponse {
  docs: DocMetaResponse[];
}

// ---------------------------------------------------------------------------
// Docs API
// ---------------------------------------------------------------------------

export const docsApi = {
  async listDocs(): Promise<ListDocsResponse> {
    return request<ListDocsResponse>('/api/v1/docs');
  },

  async createDoc(body: CreateDocRequest): Promise<DocResponse> {
    return request<DocResponse>('/api/v1/docs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getDoc(docId: string): Promise<DocResponse> {
    return request<DocResponse>(`/api/v1/docs/${docId}`);
  },

  async saveDoc(docId: string, body: SaveDocRequest): Promise<DocMetaResponse> {
    return request<DocMetaResponse>(`/api/v1/docs/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async autosaveContent(
    docId: string,
    content: string,
    filename: string,
    metadata?: { title?: string; pageSetup?: PageSetup },
    versionCheck?: ContentVersionCheck,
  ): Promise<DocMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<DocMetaResponse>(`/api/v1/docs/${docId}/autosave${contentVersionQuery(versionCheck)}`, { method: 'PUT', body: formData });
  },

  async autosaveEncryptedContent(
    docId: string,
    content: string,
    filename: string,
    dek: Uint8Array,
    metadata?: { title?: string; pageSetup?: PageSetup },
    versionCheck?: ContentVersionCheck,
  ): Promise<DocMetaResponse> {
    const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
    await initSodium();
    const plainBytes = new TextEncoder().encode(content);
    const cipherBytes = encryptFile(plainBytes, dek);
    const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<DocMetaResponse>(`/api/v1/docs/${docId}/autosave${contentVersionQuery(versionCheck)}`, { method: 'PUT', body: formData });
  },

  /**
   * Promote a raw Office (.docx) Drive file in-place into a native Neutrino
   * doc: uploads `content` (the same JSON shape a normal save would produce)
   * and flips the file's mime type server-side. Same file id afterwards.
   */
  async promoteDoc(docId: string, content: string): Promise<DocResponse> {
    return request<DocResponse>(`/api/v1/docs/${docId}/promote`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async exportText(docId: string): Promise<ExportTextResponse> {
    console.log("Exporting text...");
    return request<ExportTextResponse>(`/api/v1/docs/${docId}/export/text`);
  },

};

// ---------------------------------------------------------------------------
// Docs Templates types & API
// ---------------------------------------------------------------------------

export interface DocTemplate {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  category: string | null;
  contentJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListDocTemplatesResponse {
  templates: DocTemplate[];
}

export interface CreateDocTemplateRequest {
  name: string;
  description?: string;
  category?: string;
  contentJson?: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  isDefault?: boolean;
  category?: string;
}

export interface UseTemplateResponse {
  docId: string;
}

export const docsTemplates = {
  async list(): Promise<ListDocTemplatesResponse> {
    return request<ListDocTemplatesResponse>('/api/v1/docs/templates');
  },

  async create(req: CreateDocTemplateRequest): Promise<DocTemplate> {
    return request<DocTemplate>('/api/v1/docs/templates', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async get(id: string): Promise<DocTemplate> {
    return request<DocTemplate>(`/api/v1/docs/templates/${id}`);
  },

  async update(id: string, req: UpdateTemplateRequest): Promise<DocTemplate> {
    return request<DocTemplate>(`/api/v1/docs/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(req),
    });
  },

  async delete(id: string): Promise<void> {
    return request<void>(`/api/v1/docs/templates/${id}`, { method: 'DELETE' });
  },

  async use(id: string, title?: string): Promise<UseTemplateResponse> {
    return request<UseTemplateResponse>(`/api/v1/docs/templates/${id}/use`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  },
};
