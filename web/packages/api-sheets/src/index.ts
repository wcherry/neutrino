import { request } from '@neutrino/api-core';

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
}

export interface SheetMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
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

export const sheetsApi = {
  async listSheets(): Promise<ListSheetsResponse> {
    return request<ListSheetsResponse>('/api/v1/sheets');
  },

  async createSheet(body: CreateSheetRequest): Promise<SheetResponse> {
    return request<SheetResponse>('/api/v1/sheets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getSheet(sheetId: string): Promise<SheetResponse> {
    return request<SheetResponse>(`/api/v1/sheets/${sheetId}`);
  },

  async saveSheet(sheetId: string, body: SaveSheetRequest): Promise<SheetMetaResponse> {
    return request<SheetMetaResponse>(`/api/v1/sheets/${sheetId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
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
