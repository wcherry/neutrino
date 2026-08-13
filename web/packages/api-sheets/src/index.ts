import {
  request,
  contentVersionQuery,
  ApiClientError,
  type ContentVersionCheck,
} from '@neutrino/api-core';

/**
 * A file is a native Neutrino spreadsheet because it carries this mime type —
 * there is no `sheets` table behind it any more. Mirrors
 * `src/drive/storage/native_types.rs` on the backend.
 */
export const SHEET_MIME_TYPE = 'application/x-neutrino-sheet';

// ---------------------------------------------------------------------------
// Sheet text extraction helpers
// ---------------------------------------------------------------------------

type SheetCell = { raw?: string; value?: string };
type SheetData = { cells?: Record<string, SheetCell> };
type SheetFileContent = { sheets?: SheetData[] };

/**
 * Flatten a stored `sheet.json` body into searchable plain text — every cell's
 * displayed value, with formula sources skipped in favour of their result.
 *
 * Takes the already-decrypted body rather than fetching it: sheet content is
 * E2EE, so only the caller holds the DEK needed to read it (see
 * `readDocumentText` in the web app).
 */
export function extractSheetText(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as SheetFileContent;
    const parts: string[] = [];
    for (const s of parsed.sheets ?? []) {
      for (const cell of Object.values(s.cells ?? {})) {
        const text = cell.value ?? (cell.raw?.startsWith('=') ? '' : cell.raw);
        if (text) parts.push(text);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Sheets types
// ---------------------------------------------------------------------------

export interface SheetResponse {
  id: string;
  title: string;
  /** Path to read spreadsheet content directly from the drive API (GET). */
  contentUrl: string;
  /** Path to write spreadsheet content directly to the drive API (multipart POST). */
  contentWriteUrl: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The current user's role: "owner", "editor", "commenter", or "viewer". */
  yourRole: string;
  /**
   * Server-side content revision at load time. The editor sends it back as
   * `expectedContentVersion` on its first save, so a document changed by
   * another device since it was opened is caught immediately.
   */
  contentVersion: number;
}

export interface SheetMetaResponse {
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

export interface CreateSheetRequest {
  title: string;
  folderId?: string | null;
}

export interface SaveSheetRequest {
  title?: string;
}

export interface ListSheetsResponse {
  sheets: SheetMetaResponse[];
}

// ---------------------------------------------------------------------------
// Sheets API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Named range types
// ---------------------------------------------------------------------------

export interface CreateNamedRangeRequest {
  /** Tab identifier within the workbook (FortuneSheet index, e.g. "0"). */
  sheetId?: string;
  /** The parent spreadsheet file ID (same as the :id path param). */
  sheetDbId: string;
  /** 0-based inclusive start row. */
  startRow: number;
  /** 0-based inclusive start column. */
  startCol: number;
  /** 0-based inclusive end row. */
  endRow: number;
  /** 0-based inclusive end column. */
  endCol: number;
}

export interface NamedRangeResponse {
  id: string;
  sheetDbId: string;
  sheetId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  createdAt: string;
  updatedAt: string;
}

export interface SheetEmbedResponse {
  namedRangeId: string;
  sheetDbId: string;
  sheetId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** 2-D array of display values. Sparse cells are null. */
  rows: (string | null)[][];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Drive adapters
// ---------------------------------------------------------------------------
//
// Spreadsheet CRUD is served by the generic drive file endpoints — there is no
// `/api/v1/sheets` resource any more. These functions keep the sheet-shaped
// request/response contract their callers were written against and translate
// it to and from drive's file DTOs, so the editor doesn't have to care that a
// spreadsheet is just a Drive file with a particular mime type. What stays on
// `/api/v1/sheets` below (named ranges, AI, presence) is the part drive has no
// notion of.

/** The subset of drive's file DTOs these adapters read. */
interface DriveFileDto {
  id: string;
  name: string;
  folderId: string | null;
  mimeType?: string | null;
  createdAt: string;
  updatedAt: string;
  yourRole?: string;
  contentVersion: number;
}

/**
 * Drive serialises timestamps as naive datetimes (`2026-08-10T12:00:00`) —
 * no offset. `new Date()` reads those as *local* time, so passing one straight
 * through would shift every displayed "Modified" time by the viewer's UTC
 * offset. The values are UTC, so say so.
 */
function toIsoUtc(timestamp: string): string {
  if (!timestamp) return timestamp;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
}

function toSheetMeta(file: DriveFileDto): SheetMetaResponse {
  return {
    id: file.id,
    title: file.name,
    folderId: file.folderId ?? null,
    createdAt: toIsoUtc(file.createdAt),
    updatedAt: toIsoUtc(file.updatedAt),
    contentVersion: file.contentVersion,
  };
}

function toSheet(file: DriveFileDto): SheetResponse {
  return {
    ...toSheetMeta(file),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
    yourRole: file.yourRole ?? 'owner',
  };
}

export const sheetsApi = {
  async listSheets(): Promise<ListSheetsResponse> {
    const params = new URLSearchParams({ mimeType: SHEET_MIME_TYPE, limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { sheets: (raw.files ?? []).map(toSheetMeta) };
  },

  async createSheet(body: CreateSheetRequest): Promise<SheetResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Spreadsheet title cannot be empty');
    // Drive takes a client-supplied id so the caller can navigate to the
    // editor without waiting for the response, and seeds the empty-workbook
    // body itself from the mime type — the create and the first content write
    // are one request rather than two.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: title,
        mimeType: SHEET_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    return toSheet(file);
  },

  /**
   * Fetch a file as a native spreadsheet.
   *
   * Throws 404 for a file that exists but isn't one — a raw .xlsx, say. That
   * is load-bearing, not incidental: the editor's office-mode fallback keys
   * off this 404 to decide it must download and parse the file as xlsx
   * instead. Drive's `/info` answers for any file type, so the type check
   * lives here.
   */
  async getSheet(sheetId: string): Promise<SheetResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${sheetId}/info`);
    if (file.mimeType !== SHEET_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found');
    }
    return toSheet(file);
  },

  async saveSheet(sheetId: string, body: SaveSheetRequest): Promise<SheetMetaResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${sheetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: body.title }),
    });
    return toSheetMeta(file);
  },

  async autosaveContent(
    sheetId: string,
    content: string,
    filename: string,
    metadata?: { title?: string },
    versionCheck?: ContentVersionCheck,
  ): Promise<SheetMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    const file = await request<DriveFileDto>(
      `/api/v1/drive/files/${sheetId}/autosave${contentVersionQuery(versionCheck)}`,
      { method: 'PUT', body: formData },
    );
    return toSheetMeta(file);
  },

  async autosaveEncryptedContent(
    sheetId: string,
    content: string,
    filename: string,
    dek: Uint8Array,
    metadata?: { title?: string },
    versionCheck?: ContentVersionCheck,
  ): Promise<SheetMetaResponse> {
    const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
    await initSodium();
    const plainBytes = new TextEncoder().encode(content);
    const cipherBytes = encryptFile(plainBytes, dek);
    const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    const file = await request<DriveFileDto>(
      `/api/v1/drive/files/${sheetId}/autosave${contentVersionQuery(versionCheck)}`,
      { method: 'PUT', body: formData },
    );
    return toSheetMeta(file);
  },

  /**
   * Promote a raw Office (.xlsx) Drive file in-place into a native Neutrino
   * sheet: uploads `content` (the same JSON shape a normal save would
   * produce) and flips the file's mime type server-side. Same file id
   * afterwards.
   */
  async promoteSheet(sheetId: string, content: string): Promise<SheetResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${sheetId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ targetMimeType: SHEET_MIME_TYPE, content }),
    });
    return toSheet(file);
  },

  /** Create a named range for a cell selection, returning a stable GUID.
   *  Used by the paste interceptor when the user pastes a sheet selection. */
  async createNamedRange(
    sheetDbId: string,
    body: CreateNamedRangeRequest,
  ): Promise<NamedRangeResponse> {
    return request<NamedRangeResponse>(`/api/v1/sheets/${sheetDbId}/named-ranges`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Resolve a named range GUID to current bounds and return the cell data.
   *  Used by the embed renderer to show live data and by "Check for updates". */
  async getSheetEmbed(
    sheetDbId: string,
    namedRangeId: string,
  ): Promise<SheetEmbedResponse> {
    return request<SheetEmbedResponse>(`/api/v1/sheets/${sheetDbId}/embed/${namedRangeId}`, undefined);
  },
};

// ---------------------------------------------------------------------------
// Sheets AI types & API
// ---------------------------------------------------------------------------

export interface SmartFillResponse {
  values: string[];
}

export interface ExploreResponse {
  answer: string;
  formula: string | null;
  chartConfig: unknown | null;
}

export interface Insight {
  row: number;
  col: number;
  type: string;
  message: string;
}

export const sheetsAI = {
  async smartFill(
    sheetId: string,
    columnValues: string[],
    examples: [string, string][]
  ): Promise<SmartFillResponse> {
    return request<SmartFillResponse>(`/api/v1/sheets/${sheetId}/ai/smart-fill`, {
      method: 'POST',
      body: JSON.stringify({ columnValues, examples }),
    });
  },

  async explore(sheetId: string, question: string, sheetData: string): Promise<ExploreResponse> {
    return request<ExploreResponse>(`/api/v1/sheets/${sheetId}/ai/explore`, {
      method: 'POST',
      body: JSON.stringify({ question, sheetData }),
    });
  },

  async pivot(sheetId: string, prompt: string, sheetData: string): Promise<unknown> {
    return request<unknown>(`/api/v1/sheets/${sheetId}/ai/pivot`, {
      method: 'POST',
      body: JSON.stringify({ prompt, sheetData }),
    });
  },

  async insights(sheetId: string, sheetData: string): Promise<Insight[]> {
    return request<Insight[]>(`/api/v1/sheets/${sheetId}/ai/insights`, {
      method: 'POST',
      body: JSON.stringify({ sheetData }),
    });
  },
};
