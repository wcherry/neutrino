import { aiCredentials, request, contentVersionQuery, ApiClientError, type ContentVersionCheck } from '@neutrino/api-core';

/**
 * A file is a native Neutrino diagram because it carries this mime type.
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const DIAGRAM_MIME_TYPE = 'application/x-neutrino-diagram';

/**
 * The other format a diagram can be stored in: a plain `.svg`.
 *
 * There is no second private mime type and there must not be one — the point of
 * saving as SVG is that the file *is* an SVG, so a browser, a design tool or a
 * README renders it without Neutrino. What makes it reopenable here is a
 * `<metadata>` element carrying the diagram source (`embedDiagramSource`
 * below), which every SVG reader ignores.
 */
export const DIAGRAM_SVG_MIME_TYPE = 'image/svg+xml';

/** Which of the two formats a diagram file is stored in. */
export type DiagramFormat = 'diagram' | 'svg';

export const DIAGRAM_MIME_FOR_FORMAT: Record<DiagramFormat, string> = {
  diagram: DIAGRAM_MIME_TYPE,
  svg: DIAGRAM_SVG_MIME_TYPE,
};

/**
 * The name the editor writes content under. Drive keeps the file's own name;
 * this only names the multipart part, and it is what the extension on a
 * downloaded revision comes from.
 */
export const DIAGRAM_CONTENT_FILENAME: Record<DiagramFormat, string> = {
  diagram: 'diagram.json',
  svg: 'diagram.svg',
};

/** The format a Drive mime type opens as, or null when it is neither. */
export function diagramFormatForMime(mimeType: string | null | undefined): DiagramFormat | null {
  if (mimeType === DIAGRAM_MIME_TYPE) return 'diagram';
  if (mimeType === DIAGRAM_SVG_MIME_TYPE) return 'svg';
  return null;
}

// ---------------------------------------------------------------------------
// The SVG container
// ---------------------------------------------------------------------------
//
// An SVG-stored diagram is a real SVG with the diagram's own JSON riding along
// inside it, the way a JPEG carries EXIF: the picture is what any reader sees,
// the source is what this editor reopens. Without it "save as SVG" would be a
// one-way door — shapes, connectors, pages, data bindings and conditional rules
// have no SVG spelling, and re-deriving them from paths is guesswork.
//
// The payload is base64 so no label, colour or `<` in the document can end the
// element early; the element itself is `<metadata>`, which is the one SVG
// element defined to hold exactly this and to render as nothing.

/** The `id` on the `<metadata>` element holding the diagram source. */
export const DIAGRAM_SVG_METADATA_ID = 'neutrino-diagram';

const METADATA_RE =
  /<metadata\b[^>]*\bid=["']neutrino-diagram["'][^>]*>([\s\S]*?)<\/metadata>/i;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Put `source` (the diagram document as JSON) inside `svg`, replacing any
 * payload already there so re-saving does not stack copies of the document up
 * inside the file.
 *
 * The element goes immediately after the opening `<svg>` tag. An `svg` string
 * with no opening tag is returned untouched — there is nothing to embed into,
 * and producing an invalid document would be worse than producing a picture
 * that cannot be reopened.
 */
export function embedDiagramSource(svg: string, source: string): string {
  const element =
    `<metadata id="${DIAGRAM_SVG_METADATA_ID}" data-neutrino-format="diagram-json"` +
    ` data-neutrino-encoding="base64">${toBase64(source)}</metadata>`;

  if (METADATA_RE.test(svg)) return svg.replace(METADATA_RE, element);

  const openTag = /<svg\b[^>]*>/i.exec(svg);
  if (!openTag) return svg;
  const at = openTag.index + openTag[0].length;
  return svg.slice(0, at) + element + svg.slice(at);
}

/**
 * The diagram source embedded in an SVG, or null when there is none — which is
 * the ordinary case for an SVG that came from anywhere else.
 */
export function extractDiagramSource(svg: string): string | null {
  const match = METADATA_RE.exec(svg);
  if (!match) return null;
  const payload = match[1].trim();
  if (!payload) return null;
  try {
    return fromBase64(payload);
  } catch {
    // A payload that is not base64 was not written by `embedDiagramSource`.
    return null;
  }
}

/** Whether a stored body is an SVG document rather than the diagram's JSON. */
export function looksLikeSvgBody(text: string): boolean {
  return /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg\b/i.test(text);
}

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
 *
 * Accepts either stored format. An SVG-stored diagram is indexed off its
 * embedded source, not off the `<text>` elements in the picture: the picture
 * draws one page, and the source has them all.
 */
export function extractDiagramText(raw: string): string {
  if (!raw) return '';
  const body = looksLikeSvgBody(raw) ? extractDiagramSource(raw) : raw;
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as DiagramFileContent;
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

export interface DiagramMetaResponse {
  id: string;
  title: string;
  /** Which of the two formats this one is stored in. */
  format: DiagramFormat;
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

export interface DiagramResponse extends DiagramMetaResponse {
  /** Path to read diagram content directly from the drive API (GET). */
  contentUrl: string;
  /** Path to write diagram content directly to the drive API (multipart PUT). */
  contentWriteUrl: string;
}

export interface CreateDiagramRequest {
  title: string;
  folderId?: string | null;
  /**
   * The format to store it in; defaults to the native one. `svg` creates the
   * file with no seeded body at all — the server has no way to draw a diagram,
   * and its JSON seed would not be an SVG — so the caller must write the first
   * body itself, exactly as the OOXML editors do.
   */
  format?: DiagramFormat;
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

function toDiagramMeta(file: DriveFileDto, format?: DiagramFormat): DiagramMetaResponse {
  return {
    id: file.id,
    title: file.name,
    // A response that omits the mime type is the native format: that is what
    // every diagram was before SVG storage existed, and it is the only one the
    // routes that drop the field can be returning.
    format: format ?? diagramFormatForMime(file.mimeType) ?? 'diagram',
    folderId: file.folderId ?? null,
    createdAt: toIsoUtc(file.createdAt),
    updatedAt: toIsoUtc(file.updatedAt),
    contentVersion: file.contentVersion,
  };
}

function toDiagram(file: DriveFileDto, format: DiagramFormat): DiagramResponse {
  return {
    ...toDiagramMeta(file, format),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
  };
}

export const diagramsApi = {
  /**
   * Every diagram, in both formats.
   *
   * `mimeType` takes a comma-separated list, so this is one request. An SVG is
   * listed whether or not this app wrote it — the file's mime type is all the
   * listing knows, and telling a Neutrino-authored SVG from any other one means
   * downloading and decrypting each of them, which is not what a listing does.
   * That is the same trade the Drive click path makes by routing every SVG
   * here: a picture opens on a canvas that can draw on it.
   */
  async listDiagrams(): Promise<ListDiagramsResponse> {
    const params = new URLSearchParams({
      mimeType: `${DIAGRAM_MIME_TYPE},${DIAGRAM_SVG_MIME_TYPE}`,
      limit: '200',
    });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { diagrams: (raw.files ?? []).map((file) => toDiagramMeta(file)) };
  },

  async createDiagram(body: CreateDiagramRequest): Promise<DiagramResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Diagram title cannot be empty');
    const format = body.format ?? 'diagram';
    // Drive takes a client-supplied id and seeds the blank-page body from the
    // mime type, so create and first content write are one request.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: title,
        mimeType: DIAGRAM_MIME_FOR_FORMAT[format],
        folderId: body.folderId ?? null,
      }),
    });
    return toDiagram(file, format);
  },

  async getDiagram(diagramId: string): Promise<DiagramResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${diagramId}/info`);
    const format = diagramFormatForMime(file.mimeType);
    if (!format) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Diagram not found');
    }
    return toDiagram(file, format);
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

  // The plaintext `autosaveContent` that used to sit here had no callers —
  // `DiagramEditor` has always used the encrypted one below — but an unused
  // plaintext writer is one import away from being a used one (issue #95).

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

// ---------------------------------------------------------------------------
// Diagrams AI
// ---------------------------------------------------------------------------

/** A shape as the generator returns it — geometry and label only, no styling. */
export interface GeneratedShape {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** A connector as the generator returns it; the ids name shapes in the same response. */
export interface GeneratedConnector {
  type: string;
  sourceId: string;
  targetId: string;
  label: string;
}

export interface GenerateDiagramResponse {
  shapes: GeneratedShape[];
  connectors: GeneratedConnector[];
}

export const diagramsAI = {
  /**
   * Draw a diagram from a plain-language description.
   *
   * Takes no diagram id: generation reads nothing from the stored file, which is E2EE and so
   * unreadable by the server in any case.
   */
  async generate(prompt: string): Promise<GenerateDiagramResponse> {
    return request<GenerateDiagramResponse>('/api/v1/diagrams/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ ...aiCredentials(), prompt }),
    });
  },
};
