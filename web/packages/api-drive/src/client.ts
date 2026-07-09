import { request, buildQuery, ApiClientError, BASE_URL } from '@neutrino/api-core';
import type { PaginatedResponse } from '@neutrino/api-core';
import type {
  FileItem,
  FileListQuery,
  QuotaInfo,
  FileVersionItem,
  ListVersionsResponse,
  ZipContentsResponse,
  Folder,
  FolderContentsResponse,
  StarredContentsResponse,
  FolderCreateRequest,
  FolderUpdateRequest,
  FileUpdateRequest,
  BulkMoveRequest,
  BulkDeleteRequest,
  Shortcut,
  ShortcutCreateRequest,
  Permission,
  ListPermissionsResponse,
  GrantPermissionRequest,
  UpdatePermissionRequest,
  ShareLink,
  UpsertShareLinkRequest,
  UpdateShareLinkRequest,
  ResolvedShareLink,
  GuestSessionResponse,
  UserLookup,
  AccessRequest,
  ListAccessRequestsResponse,
  CreateAccessRequestRequest,
  ApproveAccessRequestRequest,
  SharedWithMeResponse,
  Comment,
  CommentReply,
  CommentListResponse,
  BackendFileListResponse,
  ResourceType,
  TrashContentsResponse,
  SharedDriveListResponse,
  FileKeyResponse,
  SetFileKeyRequest,
  ShareFileKeyRequest,
  NotificationListResponse,
} from './types';

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeShareLinkVisibility(
  visibility: string | null | undefined
): ShareLink['visibility'] {
  if (visibility === 'public') return 'public';
  if (visibility === 'anyoneWithLink') return 'anyoneWithLink';
  if (visibility === 'anyone_with_link') return 'anyoneWithLink';
  return 'anyoneWithLink';
}

function normalizeShareLink(link: ShareLink): ShareLink {
  return { ...link, visibility: normalizeShareLinkVisibility((link as ShareLink).visibility) };
}

function normalizeResolvedShareLink(link: ResolvedShareLink): ResolvedShareLink {
  return { ...link, visibility: normalizeShareLinkVisibility(link.visibility) };
}

// ---------------------------------------------------------------------------
// Storage API
// ---------------------------------------------------------------------------

export const storageApi = {
  async uploadFile(
    file: File,
    onProgress?: (percent: number) => void,
    folderId?: string | null,
  ): Promise<FileItem> {
    const formData = new FormData();
    if (folderId) formData.append('folder_id', folderId);
    formData.append('file', file);
    return request<FileItem>('/api/v1/drive/files/upload', {
      method: 'POST',
      body: formData,
    }, { onUploadProgress: onProgress });
  },

  async listFiles(
    query: FileListQuery = {}
  ): Promise<PaginatedResponse<FileItem>> {
    const { limit = 50, offset = 0, orderBy, direction } = query;
    const qs = buildQuery({ limit, offset, orderBy, direction });
    const raw = await request<BackendFileListResponse>(`/api/v1/drive/files${qs}`);
    return {
      items: raw.files,
      total: raw.total,
      page: Math.floor(raw.offset / raw.limit) + 1,
      pageSize: raw.limit,
      totalPages: Math.ceil(raw.total / raw.limit),
    };
  },

  async getFileMetadata(fileId: string): Promise<FileItem> {
    return request<FileItem>(`/api/v1/drive/files/${fileId}/metadata`);
  },

  getFileDownloadUrl(fileId: string): string {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
    return `${BASE_URL}/api/v1/drive/files/${fileId}?token=${token ?? ''}`;
  },

  async downloadFile(fileId: string): Promise<Blob> {
    return request<Blob>(`/api/v1/drive/files/${fileId}`, {}, { responseType: 'blob' });
  },

  async getQuota(): Promise<QuotaInfo> {
    return request<QuotaInfo>('/api/v1/drive/quota');
  },

  async deleteFile(fileId: string): Promise<void> {
    return request<void>(`/api/v1/drive/files/${fileId}`, { method: 'DELETE' });
  },

  /** Fetch file content as a Blob URL for in-browser preview. Caller must call URL.revokeObjectURL when done. */
  async fetchPreviewBlobUrl(fileId: string): Promise<string> {
    const blob = await request<Blob>(`/api/v1/drive/files/${fileId}/preview`, {}, { responseType: 'blob' });
    return URL.createObjectURL(blob);
  },

  /** Fetch text content of a file for preview (text/code files). */
  async fetchPreviewText(fileId: string): Promise<string> {
    return request<string>(`/api/v1/drive/files/${fileId}/preview`, {}, { responseType: 'text' });
  },

  async getZipContents(fileId: string): Promise<ZipContentsResponse> {
    return request<ZipContentsResponse>(`/api/v1/drive/files/${fileId}/zip-contents`);
  },

  async listVersions(fileId: string): Promise<ListVersionsResponse> {
    return request<ListVersionsResponse>(`/api/v1/drive/files/${fileId}/versions`);
  },

  async labelVersion(fileId: string, versionId: string, label: string): Promise<FileVersionItem> {
    return request<FileVersionItem>(`/api/v1/drive/files/${fileId}/versions/${versionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    });
  },

  async restoreVersion(fileId: string, versionId: string): Promise<void> {
    return request<void>(`/api/v1/drive/files/${fileId}/versions/${versionId}/restore`, {
      method: 'POST',
    });
  },

  /** Download the raw content of a specific version snapshot as text. */
  async downloadVersionContent(fileId: string, versionId: string): Promise<string> {
    const res = await fetch(`/api/v1/drive/files/${fileId}/versions/${versionId}/download`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to download version: ${res.status}`);
    return res.text();
  },
};

// ---------------------------------------------------------------------------
// Filesystem API
// ---------------------------------------------------------------------------

export const filesystemApi = {
  async getStarred(limit = 5): Promise<StarredContentsResponse> {
    return request<StarredContentsResponse>(`/api/v1/drive/starred?limit=${limit}`);
  },

  async getRootContents(query: FileListQuery = {}): Promise<FolderContentsResponse> {
    const { limit = 200, offset = 0, orderBy, direction, view, type } = query;
    const qs = buildQuery({ limit, offset, orderBy, direction, view, type });
    return request<FolderContentsResponse>(`/api/v1/drive${qs}`);
  },

  async getFolderContents(folderId: string, query: FileListQuery = {}): Promise<FolderContentsResponse> {
    const { limit = 200, offset = 0, orderBy, direction } = query;
    const qs = buildQuery({ limit, offset, orderBy, direction });
    return request<FolderContentsResponse>(`/api/v1/drive/folders/${folderId}${qs}`);
  },

  async createFolder(body: FolderCreateRequest): Promise<Folder> {
    return request<Folder>('/api/v1/drive/folders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateFolder(folderId: string, body: FolderUpdateRequest): Promise<Folder> {
    return request<Folder>(`/api/v1/drive/folders/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteFolder(folderId: string): Promise<void> {
    return request<void>(`/api/v1/drive/folders/${folderId}`, { method: 'DELETE' });
  },

  async updateFile(fileId: string, body: FileUpdateRequest): Promise<FileItem> {
    return request<FileItem>(`/api/v1/drive/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async bulkMove(body: BulkMoveRequest): Promise<void> {
    return request<void>('/api/v1/drive/bulk/move', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async bulkDelete(body: BulkDeleteRequest): Promise<void> {
    return request<void>('/api/v1/drive/bulk/trash', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listTrash(): Promise<TrashContentsResponse> {
    return request<TrashContentsResponse>('/api/v1/drive/trash');
  },

  async emptyTrash(): Promise<void> {
    return request<void>('/api/v1/drive/trash', { method: 'DELETE' });
  },

  async restoreFile(fileId: string): Promise<void> {
    return request<void>(`/api/v1/drive/trash/files/${fileId}/restore`, { method: 'POST' });
  },

  async deleteFilePermanently(fileId: string): Promise<void> {
    return request<void>(`/api/v1/drive/trash/files/${fileId}`, { method: 'DELETE' });
  },

  async restoreFolder(folderId: string): Promise<void> {
    return request<void>(`/api/v1/drive/trash/folders/${folderId}/restore`, { method: 'POST' });
  },

  async deleteFolderPermanently(folderId: string): Promise<void> {
    return request<void>(`/api/v1/drive/trash/folders/${folderId}`, { method: 'DELETE' });
  },

  async createShortcut(body: ShortcutCreateRequest): Promise<Shortcut> {
    return request<Shortcut>('/api/v1/drive/shortcuts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteShortcut(shortcutId: string): Promise<void> {
    return request<void>(`/api/v1/drive/shortcuts/${shortcutId}`, { method: 'DELETE' });
  },
};

// ---------------------------------------------------------------------------
// Permissions API
// ---------------------------------------------------------------------------

export const permissionsApi = {
  async listPermissions(resourceType: ResourceType, resourceId: string): Promise<ListPermissionsResponse> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/permissions`
      : `/api/v1/drive/folders/${resourceId}/permissions`;
    return request<ListPermissionsResponse>(path);
  },

  async grantPermission(resourceType: ResourceType, resourceId: string, body: GrantPermissionRequest): Promise<Permission> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/permissions`
      : `/api/v1/drive/folders/${resourceId}/permissions`;
    return request<Permission>(path, { method: 'POST', body: JSON.stringify(body) });
  },

  async updatePermission(resourceType: ResourceType, resourceId: string, userId: string, body: UpdatePermissionRequest): Promise<Permission> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/permissions/${userId}`
      : `/api/v1/drive/folders/${resourceId}/permissions/${userId}`;
    return request<Permission>(path, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async revokePermission(resourceType: ResourceType, resourceId: string, userId: string): Promise<void> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/permissions/${userId}`
      : `/api/v1/drive/folders/${resourceId}/permissions/${userId}`;
    return request<void>(path, { method: 'DELETE' });
  },

  async transferOwnership(resourceType: ResourceType, resourceId: string, newOwnerId: string): Promise<void> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/transfer-ownership`
      : `/api/v1/drive/folders/${resourceId}/transfer-ownership`;
    return request<void>(path, { method: 'POST', body: JSON.stringify({ newOwnerId }) });
  },
};

// ---------------------------------------------------------------------------
// Sharing (share link) API
// ---------------------------------------------------------------------------

export const sharingApi = {
  async getShareLink(resourceType: ResourceType, resourceId: string): Promise<ShareLink | null> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/share-link`
      : `/api/v1/drive/folders/${resourceId}/share-link`;
    try {
      const link = await request<ShareLink>(path);
      return normalizeShareLink(link);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  async upsertShareLink(resourceType: ResourceType, resourceId: string, body: UpsertShareLinkRequest): Promise<ShareLink> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/share-link`
      : `/api/v1/drive/folders/${resourceId}/share-link`;
    const link = await request<ShareLink>(path, { method: 'PUT', body: JSON.stringify(body) });
    return normalizeShareLink(link);
  },

  async updateShareLink(resourceType: ResourceType, resourceId: string, body: UpdateShareLinkRequest): Promise<ShareLink> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/share-link`
      : `/api/v1/drive/folders/${resourceId}/share-link`;
    const link = await request<ShareLink>(path, { method: 'PATCH', body: JSON.stringify(body) });
    return normalizeShareLink(link);
  },

  async deleteShareLink(resourceType: ResourceType, resourceId: string): Promise<void> {
    const path = resourceType === 'file'
      ? `/api/v1/drive/files/${resourceId}/share-link`
      : `/api/v1/drive/folders/${resourceId}/share-link`;
    return request<void>(path, { method: 'DELETE' });
  },

  async resolveToken(token: string): Promise<ResolvedShareLink> {
    const link = await request<ResolvedShareLink>(`/api/v1/share/${token}`, {}, { auth: 'none' });
    return normalizeResolvedShareLink(link);
  },

  async createGuestSession(token: string): Promise<GuestSessionResponse> {
    return request<GuestSessionResponse>(`/api/v1/share/${token}/session`, { method: 'POST' }, { auth: 'none' });
  },
};

export function getShareDownloadUrl(token: string): string {
  return `${BASE_URL}/api/v1/share/${token}/download`;
}

export function getSharePreviewUrl(token: string): string {
  return `${BASE_URL}/api/v1/share/${token}/preview`;
}

// ---------------------------------------------------------------------------
// Users API
// ---------------------------------------------------------------------------

export const usersApi = {
  async lookupByEmail(email: string): Promise<UserLookup | null> {
    try {
      return await request<UserLookup>(`/api/v1/auth/users/lookup?email=${encodeURIComponent(email)}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  async getById(userId: string): Promise<UserLookup | null> {
    try {
      return await request<UserLookup>(`/api/v1/auth/users/${userId}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  async searchUsers(query: string): Promise<UserLookup[]> {
    if (!query.trim()) return [];
    return request<UserLookup[]>(`/api/v1/auth/users/search?q=${encodeURIComponent(query.trim())}`);
  },
};

// ---------------------------------------------------------------------------
// Access Requests API
// ---------------------------------------------------------------------------

export const accessRequestsApi = {
  async requestFileAccess(fileId: string, body: CreateAccessRequestRequest): Promise<AccessRequest> {
    return request<AccessRequest>(`/api/v1/drive/files/${fileId}/request-access`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async requestFolderAccess(folderId: string, body: CreateAccessRequestRequest): Promise<AccessRequest> {
    return request<AccessRequest>(`/api/v1/drive/folders/${folderId}/request-access`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listPending(): Promise<ListAccessRequestsResponse> {
    return request<ListAccessRequestsResponse>('/api/v1/drive/access-requests');
  },

  async approve(requestId: string, body: ApproveAccessRequestRequest): Promise<AccessRequest> {
    return request<AccessRequest>(`/api/v1/drive/access-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deny(requestId: string): Promise<AccessRequest> {
    return request<AccessRequest>(`/api/v1/drive/access-requests/${requestId}/deny`, {
      method: 'POST',
    });
  },
};

// ---------------------------------------------------------------------------
// Shared With Me API
// ---------------------------------------------------------------------------

export const sharedWithMeApi = {
  async list(): Promise<SharedWithMeResponse> {
    return request<SharedWithMeResponse>('/api/v1/drive/shared-with-me');
  },
};

// ---------------------------------------------------------------------------
// Shared Drives API
// ---------------------------------------------------------------------------

export const sharedDrivesApi = {
  async list(): Promise<SharedDriveListResponse> {
    return request<SharedDriveListResponse>('/api/v1/drive/shared-drives');
  },
};

// ---------------------------------------------------------------------------
// Drive content helpers
// ---------------------------------------------------------------------------

export async function driveReadContent(path: string): Promise<string> {
  return request<string>(path, {}, { responseType: 'text' });
}

export async function driveWriteContent(path: string, content: string, filename: string): Promise<void> {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'application/json' }), filename);
  return request<void>(path, { method: 'POST', body: formData });
}

/** Autosave: write content to the file without creating a version snapshot. */
export async function driveAutosaveContent(fileId: string, content: string, filename: string): Promise<void> {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'application/json' }), filename);
  return request<void>(`/api/v1/drive/files/${fileId}/autosave`, { method: 'PUT', body: formData });
}

/** Explicit save: write content and create a new version snapshot. */
export async function driveCreateVersion(fileId: string, content: string, filename: string, label?: string): Promise<FileVersionItem> {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'application/json' }), filename);
  if (label) formData.append('label', label);
  return request<FileVersionItem>(`/api/v1/drive/files/${fileId}/versions`, { method: 'POST', body: formData });
}

// ---------------------------------------------------------------------------
// E2EE Upload helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt a file client-side and upload the ciphertext to the server.
 * After a successful upload, stores the encrypted DEK as a key_ref.
 *
 * @param file       The plaintext file chosen by the user.
 * @param dek        The 32-byte DEK generated for this file.
 * @param encryptedFileKey  The DEK sealed to the owner's public key (base64url).
 * @param encryptedMetadata The metadata JSON encrypted with the DEK (base64url).
 * @param onProgress Optional progress callback (0–100).
 * @param folderId   Optional target folder.
 */
export async function uploadEncryptedFile(
  file: File,
  dek: Uint8Array,
  encryptedFileKey: string,
  encryptedMetadata: string,
  onProgress?: (percent: number) => void,
  folderId?: string | null,
  thumbnailB64?: string | null,
): Promise<FileItem> {
  // Encrypt the file bytes.
  const { encryptFile } = await import('@neutrino/e2e-crypto');
  const plainBytes = new Uint8Array(await file.arrayBuffer());
  const cipherBytes = encryptFile(plainBytes, dek);
  // Cast to ArrayBuffer for Blob compatibility across TS targets.
  const cipherBlob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const encryptedFile = new File([cipherBlob], file.name, { type: 'application/octet-stream' });

  const formData = new FormData();
  if (folderId) formData.append('folder_id', folderId);
  // Pass encrypted_metadata so the server stores it alongside the blob.
  formData.append('encrypted_metadata', encryptedMetadata);
  // Pass the original MIME type explicitly — the encrypted blob is typed as
  // application/octet-stream, so the server can't infer the real type from it.
  if (file.type) formData.append('mime_type', file.type);
  if (thumbnailB64) {
    console.log('[uploadEncryptedFile] appending thumbnail_b64, length:', thumbnailB64.length);
    formData.append('thumbnail_b64', thumbnailB64);
  } else {
    console.log('[uploadEncryptedFile] no thumbnail_b64 to append');
  }
  formData.append('file', encryptedFile);

  const item = await request<FileItem>('/api/v1/drive/files/upload', {
    method: 'POST',
    body: formData,
  }, { onUploadProgress: onProgress });

  // Store the encrypted DEK on the server.
  await request<FileKeyResponse>(`/api/v1/drive/files/${item.id}/key`, {
    method: 'PUT',
    body: JSON.stringify({ encryptedFileKey }),
  });

  return item;
}

/**
 * Download an E2EE file and decrypt it client-side.
 *
 * @param fileId   The file to download.
 * @param publicKey The user's Curve25519 public key.
 * @param secretKey The user's Curve25519 secret key.
 * @returns        The decrypted plaintext as a Uint8Array, or null if no key ref exists.
 */
export async function downloadAndDecryptFile(
  fileId: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Promise<Uint8Array | null> {
  const { initSodium, decryptFileKey, decryptFile } = await import('@neutrino/e2e-crypto');
  await initSodium();

  // Fetch the encrypted DEK.
  const keyRef = await request<FileKeyResponse>(`/api/v1/drive/files/${fileId}/key`).catch(
    (e) => {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    },
  );
  if (!keyRef) return null;

  const dek = decryptFileKey(keyRef.encryptedFileKey, publicKey, secretKey);

  // Download the encrypted blob.
  const cipherBlob = await request<Blob>(
    `/api/v1/drive/files/${fileId}`,
    {},
    { responseType: 'blob' },
  );
  const cipherBytes = new Uint8Array(await cipherBlob.arrayBuffer());

  return decryptFile(cipherBytes, dek);
}

/**
 * Encrypt `content` with `dek` and write it as an autosave (no version snapshot).
 */
export async function driveAutosaveEncryptedContent(
  fileId: string,
  content: string,
  filename: string,
  dek: Uint8Array,
): Promise<void> {
  const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
  await initSodium();
  const plainBytes = new TextEncoder().encode(content);
  const cipherBytes = encryptFile(plainBytes, dek);
  const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, filename);
  return request<void>(`/api/v1/drive/files/${fileId}/autosave`, { method: 'PUT', body: formData });
}

/**
 * Encrypt `content` with `dek` and save it as a named version snapshot.
 */
export async function driveCreateEncryptedVersion(
  fileId: string,
  content: string,
  filename: string,
  dek: Uint8Array,
  label?: string,
): Promise<FileVersionItem> {
  const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
  await initSodium();
  const plainBytes = new TextEncoder().encode(content);
  const cipherBytes = encryptFile(plainBytes, dek);
  const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, filename);
  if (label) formData.append('label', label);
  return request<FileVersionItem>(`/api/v1/drive/files/${fileId}/versions`, { method: 'POST', body: formData });
}

/**
 * Encrypt `content` with `dek` and write it via the versions endpoint.
 * Alias for driveCreateEncryptedVersion used by slide editor's contentWriteUrl pattern.
 */
export async function driveWriteEncryptedContent(
  fileId: string,
  content: string,
  filename: string,
  dek: Uint8Array,
): Promise<void> {
  await driveCreateEncryptedVersion(fileId, content, filename, dek);
}

// ---------------------------------------------------------------------------
// E2EE Key Management API
// ---------------------------------------------------------------------------

export const encryptionApi = {
  /** Fetch the caller's encrypted DEK for a file. */
  async getFileKey(fileId: string): Promise<FileKeyResponse | null> {
    try {
      return await request<FileKeyResponse>(`/api/v1/drive/files/${fileId}/key`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  /** Store or update the caller's encrypted DEK for a file. */
  async setFileKey(fileId: string, body: SetFileKeyRequest): Promise<FileKeyResponse> {
    return request<FileKeyResponse>(`/api/v1/drive/files/${fileId}/key`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  /**
   * Share a file's DEK with a recipient.
   * The caller must have already re-sealed the DEK with the recipient's public key.
   */
  async shareFileKey(fileId: string, body: ShareFileKeyRequest): Promise<FileKeyResponse> {
    return request<FileKeyResponse>(`/api/v1/drive/files/${fileId}/key/share`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Remove the caller's own key ref (e.g. on leaving a shared file). */
  async deleteFileKey(fileId: string): Promise<void> {
    return request<void>(`/api/v1/drive/files/${fileId}/key`, { method: 'DELETE' });
  },
};

// ---------------------------------------------------------------------------
// Comments API
// ---------------------------------------------------------------------------

export const commentsApi = {
  async listComments(fileId: string, status?: 'open' | 'resolved'): Promise<CommentListResponse> {
    const qs = status ? `?status=${status}` : '';
    return request<CommentListResponse>(`/api/v1/drive/files/${fileId}/comments${qs}`);
  },

  async createComment(
    fileId: string,
    body: string,
    anchorJson?: string,
    assigneeId?: string,
  ): Promise<Comment> {
    return request<Comment>(`/api/v1/drive/files/${fileId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, anchorJson, assigneeId }),
    });
  },

  async updateComment(
    fileId: string,
    commentId: string,
    patch: { body?: string; status?: string },
  ): Promise<Comment> {
    return request<Comment>(`/api/v1/drive/files/${fileId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  async deleteComment(fileId: string, commentId: string): Promise<void> {
    return request<void>(`/api/v1/drive/files/${fileId}/comments/${commentId}`, {
      method: 'DELETE',
    });
  },

  async addReply(fileId: string, commentId: string, body: string): Promise<CommentReply> {
    return request<CommentReply>(`/api/v1/drive/files/${fileId}/comments/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  },

  async deleteReply(fileId: string, commentId: string, replyId: string): Promise<void> {
    return request<void>(
      `/api/v1/drive/files/${fileId}/comments/${commentId}/replies/${replyId}`,
      { method: 'DELETE' },
    );
  },
};

// ---------------------------------------------------------------------------
// Notifications API
// ---------------------------------------------------------------------------

export const notificationsApi = {
  async list(page?: number, pageSize?: number): Promise<NotificationListResponse> {
    const qs = new URLSearchParams();
    if (page !== undefined) qs.set('page', String(page));
    if (pageSize !== undefined) qs.set('pageSize', String(pageSize));
    const query = qs.toString() ? `?${qs}` : '';
    return request<NotificationListResponse>(`/api/v1/drive/notifications${query}`);
  },

  async markRead(id: string): Promise<void> {
    return request<void>(`/api/v1/drive/notifications/${id}/read`, { method: 'POST' });
  },

  async markAllRead(): Promise<void> {
    return request<void>('/api/v1/drive/notifications/read-all', { method: 'POST' });
  },
};

export function getNotificationsWsUrl(): string {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  const base = apiUrl
    ? apiUrl.replace(/^http/, 'ws')
    : `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'}://${typeof window !== 'undefined' ? window.location.host : ''}`;
  return `${base}/api/v1/drive/notifications/ws?token=${token ?? ''}`;
}
