import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Notes types
// ---------------------------------------------------------------------------

export interface NoteResponse {
  id: string;
  title: string;
  content: string;
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
  content: string;
  title?: string;
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
