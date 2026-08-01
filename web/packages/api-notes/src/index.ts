import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Note text extraction helpers
// ---------------------------------------------------------------------------

type NoteTableCell = { content?: string };
type NoteTableRow = { cells?: NoteTableCell[] };
type NoteBlock = { content?: string; tableData?: { rows?: NoteTableRow[] } };

/**
 * Flatten a stored note body into searchable plain text — every block's prose
 * plus any table cells.
 *
 * Note bodies are `JSON.stringify(Block[])`, so indexing the raw string would
 * feed block ids and JSON keys to the tokenizer. Legacy notes were saved as
 * plain text and are returned as-is.
 *
 * Takes the already-decrypted body rather than fetching it: note content is
 * E2EE, so only the caller holds the DEK needed to read it (see
 * `readDocumentText` in the web app).
 */
export function extractNoteText(raw: string): string {
  if (!raw.trim()) return '';

  let blocks: NoteBlock[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw.replace(/\s+/g, ' ').trim();
    blocks = parsed as NoteBlock[];
  } catch {
    return raw.replace(/\s+/g, ' ').trim();
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.content) parts.push(block.content);
    for (const row of block.tableData?.rows ?? []) {
      for (const cell of row.cells ?? []) {
        if (cell.content) parts.push(cell.content);
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Notes types
// ---------------------------------------------------------------------------

export interface NoteResponse {
  id: string;
  title: string;
  /** Path to read note content directly from the drive API (GET). */
  contentUrl: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteRequest {
  title: string;
  folderId?: string | null;
}

export interface SaveNoteRequest {
  /** Omit for a pure rename (title-only save) — content/links stay untouched. */
  content?: string;
  title?: string;
  /**
   * Wiki-link target titles extracted client-side from the plaintext content.
   * Required once content is E2EE-encrypted, since the server can no longer
   * read `[[links]]` out of ciphertext.
   */
  linkedTitles?: string[];
}

export interface ListNotesResponse {
  notes: NoteMetaResponse[];
}

export interface NoteLinkItem {
  id: string;
  title: string;
}

export interface BacklinksResponse {
  backlinks: NoteLinkItem[];
}

// ---------------------------------------------------------------------------
// Notes API
// ---------------------------------------------------------------------------

export const notesApi = {
  async listNotes(): Promise<ListNotesResponse> {
    return request<ListNotesResponse>('/api/v1/notes');
  },

  async createNote(body: CreateNoteRequest): Promise<NoteResponse> {
    return request<NoteResponse>('/api/v1/notes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getNote(noteId: string): Promise<NoteResponse> {
    return request<NoteResponse>(`/api/v1/notes/${noteId}`);
  },

  async saveNote(noteId: string, body: SaveNoteRequest): Promise<NoteMetaResponse> {
    return request<NoteMetaResponse>(`/api/v1/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async getBacklinks(noteId: string): Promise<BacklinksResponse> {
    return request<BacklinksResponse>(`/api/v1/notes/${noteId}/backlinks`);
  },

  async deleteNote(noteId: string): Promise<void> {
    return request<void>(`/api/v1/notes/${noteId}`, { method: 'DELETE' });
  },
};
