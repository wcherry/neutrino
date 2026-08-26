import { request, ApiClientError } from '@neutrino/api-core';

/**
 * A file is a native Neutrino document because it carries this mime type.
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const DOC_MIME_TYPE = 'application/x-neutrino-doc';

/**
 * What a document with no stored page setup lays out to.
 *
 * Page setup lives in the document body's `_meta` block (see `serializeContent`
 * in `DocEditor`), so this is the client's own default — there is no server
 * copy to keep in step with, and a document written before page setup moved
 * into the body carries none at all.
 */
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
 * `serializeContent` in `DocEditor` wraps the Tiptap JSON as `{ doc, _meta }`
 * so page setup and the header/footer/watermark settings survive a round-trip.
 * A document with none of those — default margins, no header — is stored as
 * bare Tiptap JSON, as every document was before `_meta` existed.
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
  title?: string;
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
// Nothing here reaches /api/v1/docs any more. Page setup used to be the
// exception — server-side state with its own endpoint — and now rides in the
// document body's `_meta` block, which means the editor reads it out of the
// decrypted content rather than from a metadata call.

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

function toDoc(file: DriveFileDto): DocResponse {
  return {
    ...toDocMeta(file),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
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
    return toDoc(file);
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
    return toDoc(file);
  },

  /**
   * Rename. A document's name is its Drive file's name, so this is a PATCH on
   * the file; with no title supplied it degrades to a metadata read, which is
   * what callers that only want the current `contentVersion` back rely on.
   */
  async saveDoc(docId: string, body: SaveDocRequest): Promise<DocMetaResponse> {
    const file = body.title !== undefined
      ? await request<DriveFileDto>(`/api/v1/drive/files/${docId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: body.title }),
        })
      : await request<DriveFileDto>(`/api/v1/drive/files/${docId}/info`);
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
    return toDoc(file);
  },
};

