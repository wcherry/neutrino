import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Links types
// ---------------------------------------------------------------------------

export interface UpdateLinksRequest {
  /**
   * Wiki-link target titles extracted client-side from a file's plaintext
   * content. Resolved case-insensitively against the caller's own files;
   * titles that don't resolve, resolve to a deleted file, or resolve to a
   * file the caller can't read are silently dropped server-side — that's
   * normal, not an error.
   */
  linkedTitles?: string[];
}

export interface FileLinkItem {
  id: string;
  title: string;
  /** Short label derived from the linked file's drive MIME type, e.g. "note", "doc", "sheet". */
  fileType: string;
}

export interface BacklinksResponse {
  backlinks: FileLinkItem[];
}

// ---------------------------------------------------------------------------
// Links API
// ---------------------------------------------------------------------------

export const linksApi = {
  async getBacklinks(fileId: string): Promise<BacklinksResponse> {
    return request<BacklinksResponse>(`/api/v1/links/${fileId}/backlinks`);
  },

  async updateLinks(fileId: string, body: UpdateLinksRequest): Promise<BacklinksResponse> {
    return request<BacklinksResponse>(`/api/v1/links/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
};
