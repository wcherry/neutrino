import {
  aiCredentials,
  request,
  contentVersionQuery,
  ApiClientError,
  ooxmlMimeFor,
  isOoxmlMime,
  withOoxmlExtension,
  stripOoxmlExtension,
  type ContentVersionCheck,
} from '@neutrino/api-core';

/**
 * What a spreadsheet created today is: a real Excel workbook (issue #127), so
 * every other office suite can open one and import/export are file copies.
 */
export const XLSX_MIME_TYPE = ooxmlMimeFor('sheets');

/**
 * The bespoke JSON spreadsheets were written in before OOXML. Still read and
 * still written — a spreadsheet created in it stays in it, there is no
 * migration — which is why the library asks for both types.
 *
 * There is no `sheets` table behind either of them; the mime type is the whole
 * marker. Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const SHEET_MIME_TYPE = 'application/x-neutrino-sheet';

/** Both formats a file may be a native Neutrino spreadsheet in. */
export const SHEET_MIME_TYPES = [XLSX_MIME_TYPE, SHEET_MIME_TYPE] as const;

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
    title: stripOoxmlExtension(file.name),
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
    const params = new URLSearchParams({ mimeType: SHEET_MIME_TYPES.join(','), limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { sheets: (raw.files ?? []).map(toSheetMeta) };
  },

  async createSheet(body: CreateSheetRequest): Promise<SheetResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Spreadsheet title cannot be empty');
    // Drive takes a client-supplied id so the caller can navigate to the
    // editor without waiting for the response. The record is created with no
    // body: an `.xlsx` is a zip, which the server has no business building and
    // could only write in the clear anyway, so the editor opens the empty file
    // as a blank workbook and its first save writes a real, sealed package.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: withOoxmlExtension(title, 'sheets'),
        mimeType: XLSX_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    return toSheet(file);
  },

  /**
   * Fetch a file as a spreadsheet in the *bespoke JSON* format.
   *
   * Throws 404 for anything else, `.xlsx` included. That is load-bearing and
   * not an oversight: the two formats are read and written by different code
   * paths in the editor, and this 404 is how it learns to take the OOXML one —
   * download the package, prefer the model inside it, fall back to parsing the
   * workbook. Drive's `/info` answers for any file type, so the type check
   * lives here.
   */
  async getSheet(sheetId: string): Promise<SheetResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${sheetId}/info`);
    if (file.mimeType !== SHEET_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Spreadsheet not found');
    }
    return toSheet(file);
  },

  /**
   * Rename.
   *
   * Reads the file first, because the extension is not the caller's business:
   * it passes the title the user typed, and whether that has to land on disk
   * as `Budget` or `Budget.xlsx` depends on the format the file is already in.
   * Renaming an `.xlsx` to a bare name would leave a workbook the operating
   * system no longer recognises.
   */
  async saveSheet(sheetId: string, body: SaveSheetRequest): Promise<SheetMetaResponse> {
    const current = await request<DriveFileDto>(`/api/v1/drive/files/${sheetId}/info`);
    if (body.title === undefined) return toSheetMeta(current);
    const name = isOoxmlMime(current.mimeType ?? '')
      ? withOoxmlExtension(body.title, 'sheets')
      : body.title;
    if (name === current.name) return toSheetMeta(current);

    const file = await request<DriveFileDto>(`/api/v1/drive/files/${sheetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
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
      body: JSON.stringify({ ...aiCredentials(), columnValues, examples }),
    });
  },

  async explore(sheetId: string, question: string, sheetData: string): Promise<ExploreResponse> {
    return request<ExploreResponse>(`/api/v1/sheets/${sheetId}/ai/explore`, {
      method: 'POST',
      body: JSON.stringify({ ...aiCredentials(), question, sheetData }),
    });
  },

  async pivot(sheetId: string, prompt: string, sheetData: string): Promise<unknown> {
    return request<unknown>(`/api/v1/sheets/${sheetId}/ai/pivot`, {
      method: 'POST',
      body: JSON.stringify({ ...aiCredentials(), prompt, sheetData }),
    });
  },

  async insights(sheetId: string, sheetData: string): Promise<Insight[]> {
    return request<Insight[]>(`/api/v1/sheets/${sheetId}/ai/insights`, {
      method: 'POST',
      body: JSON.stringify({ ...aiCredentials(), sheetData }),
    });
  },
};
