import { request, ApiClientError } from '@neutrino/api-core';

/**
 * A file is a native Neutrino document because it carries this mime type.
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const DOC_MIME_TYPE = 'application/x-neutrino-doc';

/** Matches `default_page_setup()` in `src/docs/docs/service.rs`. */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  marginTop: 72,
  marginBottom: 72,
  marginLeft: 72,
  marginRight: 72,
  orientation: 'portrait',
  pageSize: 'letter',
};

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
// Docs API — drive adapters
// ---------------------------------------------------------------------------
//
// Document CRUD is served by the generic drive file endpoints; a document is a
// Drive file whose mime type is `application/x-neutrino-doc`. These functions
// keep the doc-shaped contract their callers were written against and
// translate it to and from drive's file DTOs.
//
// Page setup is the exception: it is real per-document state Drive has no
// notion of, so it keeps its own endpoint under /api/v1/docs and is stitched
// in here. A document that has never had its margins changed has no stored row
// and the endpoint answers with the defaults.

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

function toDocMeta(file: DriveFileDto): DocMetaResponse {
  return {
    id: file.id,
    title: file.name,
    folderId: file.folderId ?? null,
    createdAt: toIsoUtc(file.createdAt),
    updatedAt: toIsoUtc(file.updatedAt),
    contentVersion: file.contentVersion,
  };
}

function toDoc(file: DriveFileDto, pageSetup: PageSetup): DocResponse {
  return {
    ...toDocMeta(file),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
    pageSetup,
  };
}

export const docsApi = {
  async listDocs(): Promise<ListDocsResponse> {
    const params = new URLSearchParams({ mimeType: DOC_MIME_TYPE, limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { docs: (raw.files ?? []).map(toDocMeta) };
  },

  async createDoc(body: CreateDocRequest): Promise<DocResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Document title cannot be empty');
    // Drive takes a client-supplied id and seeds the empty-document body from
    // the mime type, so create and first content write are one request.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: title,
        mimeType: DOC_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    // A brand-new document has no stored page setup, so skip the round trip.
    return toDoc(file, DEFAULT_PAGE_SETUP);
  },

  /**
   * Fetch a file as a native document.
   *
   * Throws 404 for a file that exists but isn't one — a raw .docx, say. That
   * is load-bearing: the editor's office-mode fallback keys off this 404 to
   * decide it must download and parse the file as docx instead.
   */
  async getDoc(docId: string): Promise<DocResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${docId}/info`);
    if (file.mimeType !== DOC_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Document not found');
    }
    const pageSetup = await request<PageSetup>(`/api/v1/docs/${docId}/page-setup`);
    return toDoc(file, pageSetup);
  },

  /**
   * Rename and/or restyle. The two halves live in different places now — the
   * name on the Drive file, the page setup in the docs table — so this issues
   * up to two requests, and only for the fields actually supplied.
   */
  async saveDoc(docId: string, body: SaveDocRequest): Promise<DocMetaResponse> {
    const [file] = await Promise.all([
      body.title !== undefined
        ? request<DriveFileDto>(`/api/v1/drive/files/${docId}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: body.title }),
          })
        : request<DriveFileDto>(`/api/v1/drive/files/${docId}/info`),
      body.pageSetup !== undefined
        ? request<PageSetup>(`/api/v1/docs/${docId}/page-setup`, {
            method: 'PUT',
            body: JSON.stringify(body.pageSetup),
          })
        : Promise.resolve(null),
    ]);
    return toDocMeta(file);
  },

  /**
   * Promote a raw Office (.docx) Drive file in-place into a native Neutrino
   * doc: uploads `content` (the same JSON shape a normal save would produce)
   * and flips the file's mime type server-side. Same file id afterwards.
   */
  async promoteDoc(docId: string, content: string): Promise<DocResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${docId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ targetMimeType: DOC_MIME_TYPE, content }),
    });
    return toDoc(file, DEFAULT_PAGE_SETUP);
  },

  async exportText(docId: string): Promise<ExportTextResponse> {
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
