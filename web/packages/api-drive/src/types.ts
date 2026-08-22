// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

export interface FileItem {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  folderId: string | null;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
  coverThumbnail: string | null;
  coverThumbnailMimeType: string | null;
  /** Base64url-encoded encrypted metadata blob. Present only for E2EE files. */
  encryptedMetadata?: string | null;
  /** Server-side content revision counter, incremented on every autosave/version save. */
  contentVersion: number;
  /**
   * When an import run wrote this file; absent for a file created here. On an
   * imported file `createdAt`/`updatedAt` are the source file's own dates, so
   * this is the only field that says when it actually arrived.
   */
  importedAt?: string | null;
  /** Where in the imported archive this file came from, e.g. `Takeout/Drive/Work/Q3 plan.docx`. */
  importSource?: string | null;
}

/**
 * The dates an imported file had before it was imported, plus the record of
 * where they came from.
 *
 * Sent once per file, after its content is written: the content write is what
 * stamps `updatedAt` with the current time, so dates set any earlier would not
 * survive it. `importSource` is required — this rewrites a file's history, and
 * the row keeping a note of where the dates came from is what justifies it.
 */
export interface SetImportMetadataRequest {
  /** The file's path inside the archive, e.g. `Takeout/Drive/Work/Q3 plan.docx`. */
  importSource: string;
  /** ISO 8601. Omit to leave the file's current created date alone. */
  createdAt?: string;
  /** ISO 8601. Omit to leave the file's current modified date alone. */
  updatedAt?: string;
  /** ISO 8601; defaults to the moment the server handles the request. */
  importedAt?: string;
}

/**
 * File metadata with the caller's permission role, returned by
 * `GET /files/{id}/info`. Unlike `FileItem` (which `storageApi.listFiles`/
 * `getFileMetadata` return, owner-scoped only), this endpoint is
 * permission-checked — it works for any file the caller has been granted a
 * role on, not just ones they own.
 */
export interface FileInfo {
  id: string;
  name: string;
  sizeBytes: number;
  folderId: string | null;
  deletedAt: string | null;
  yourRole: string;
  storagePath: string | null;
  mimeType: string | null;
  createdAt: string;
  updatedAt: string;
  coverThumbnail: string | null;
  coverThumbnailMimeType: string | null;
  tags: string[];
  encryptedMetadata: string | null;
  /** Server-side content revision counter, incremented on every autosave/version save. */
  contentVersion: number;
}

export interface CreateFileRequest {
  /** Client-generated id (e.g. `crypto.randomUUID()`) for the new file. */
  id: string;
  name: string;
  mimeType: string;
  folderId?: string | null;
}

/** Filter drive contents to a single kind of file, matched by MIME type. */
export type DriveFileType =
  | 'photo'
  | 'video'
  | 'audio'
  | 'document'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'diagram'
  | 'drawing'
  | 'note';

export interface FileListQuery {
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  direction?: 'asc' | 'desc';
  /** List only files of this type within the folder being listed. */
  type?: DriveFileType;
}

export interface QuotaInfo {
  usedBytes: number;
  dailyUploadBytes: number;
  dailyResetAt: string;
  quotaBytes: number | null;
  dailyCapBytes: number | null;
}

// ---------------------------------------------------------------------------
// Version types
// ---------------------------------------------------------------------------

export interface FileVersionItem {
  id: string;
  fileId: string;
  versionNumber: number;
  sizeBytes: number;
  label: string | null;
  createdAt: string;
}

export interface ListVersionsResponse {
  versions: FileVersionItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// Preview types
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  isDir: boolean;
}

export interface ZipContentsResponse {
  entries: ZipEntry[];
}

// ---------------------------------------------------------------------------
// Filesystem types
// ---------------------------------------------------------------------------

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FolderContentsResponse {
  /** Present when listing a non-root folder */
  folder: Folder | null;
  folders: Folder[];
  files: FileItem[];
}

export interface StarredContentsResponse {
  files: FileItem[];
  folders: Folder[];
}

export interface FolderCreateRequest {
  name: string;
  parentId?: string;
}

export interface FolderUpdateRequest {
  name?: string;
  parentId?: string;
  isStarred?: boolean;
}

export interface FileUpdateRequest {
  name?: string;
  /** Move to folder (null = move to root) */
  folderId?: string | null;
  isStarred?: boolean;
}

export interface BulkMoveRequest {
  fileIds: string[];
  folderIds: string[];
  targetFolderId: string | null;
}

export interface BulkDeleteRequest {
  fileIds: string[];
  folderIds: string[];
}

export interface Shortcut {
  id: string;
  targetFileId: string;
  /** Containing folder; null for a shortcut at the drive root. */
  folderId: string | null;
  createdAt: string;
}

export interface ShortcutCreateRequest {
  targetFileId: string;
  folderId?: string;
}

export interface ShortcutListResponse {
  shortcuts: Shortcut[];
}

// ---------------------------------------------------------------------------
// Permissions types
// ---------------------------------------------------------------------------

export type PermissionRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type ResourceType = 'file' | 'folder';

export interface Permission {
  id: string;
  resourceType: string;
  resourceId: string;
  userId: string;
  userEmail: string;
  userName: string;
  role: string;
  grantedBy: string;
  createdAt: string;
}

export interface ListPermissionsResponse {
  permissions: Permission[];
}

export interface GrantPermissionRequest {
  userId: string;
  userEmail: string;
  userName: string;
  role: PermissionRole;
}

export interface UpdatePermissionRequest {
  role: PermissionRole;
}

// ---------------------------------------------------------------------------
// Sharing (share link) types
// ---------------------------------------------------------------------------

export interface ShareLink {
  id: string;
  resourceType: string;
  resourceId: string;
  token: string;
  visibility: 'public' | 'anyoneWithLink';
  role: 'viewer' | 'commenter' | 'editor';
  expiresAt: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertShareLinkRequest {
  visibility?: 'public' | 'anyoneWithLink';
  role?: 'viewer' | 'commenter' | 'editor';
  expiresAt?: string | null;
}

export interface UpdateShareLinkRequest {
  visibility?: 'public' | 'anyoneWithLink';
  role?: 'viewer' | 'commenter' | 'editor';
  expiresAt?: string | null;
  isActive?: boolean;
}

export interface ResolvedShareLink {
  resourceType: string;
  resourceId: string;
  role: string;
  visibility: 'public' | 'anyoneWithLink';
  expiresAt: string | null;
  resourceName: string;
  mimeType?: string | null;
}

export interface GuestSessionResponse {
  accessToken: string;
  expiresIn: number;
  role: string;
}

// ---------------------------------------------------------------------------
// User lookup types
// ---------------------------------------------------------------------------

export interface UserLookup {
  id: string;
  email: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Access request types
// ---------------------------------------------------------------------------

export interface AccessRequest {
  id: string;
  resourceType: string;
  resourceId: string;
  requesterId: string;
  requesterEmail: string;
  requesterName: string;
  message: string | null;
  requestedRole: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  updatedAt: string;
}

export interface ListAccessRequestsResponse {
  requests: AccessRequest[];
}

export interface CreateAccessRequestRequest {
  message?: string;
  requestedRole?: string;
  requesterName: string;
}

export interface ApproveAccessRequestRequest {
  role?: string;
  requesterEmail: string;
  requesterName: string;
}

// ---------------------------------------------------------------------------
// Shared with me types
// ---------------------------------------------------------------------------

export interface SharedWithMeResponse {
  files: FileItem[];
  folders: Folder[];
}

// ---------------------------------------------------------------------------
// Comments types
// ---------------------------------------------------------------------------

export interface CommentReply {
  id: string;
  commentId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  fileId: string;
  userId: string;
  userName: string;
  anchorJson: string | null;
  body: string;
  status: 'open' | 'resolved';
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  replies: CommentReply[];
}

export interface CommentListResponse {
  comments: Comment[];
  total: number;
}

// Internal type for API response normalization
export interface BackendFileListResponse {
  files: FileItem[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Trash types
// ---------------------------------------------------------------------------

export interface TrashFileItem {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  deletedAt: string;
}

export interface TrashFolderItem {
  id: string;
  name: string;
  deletedAt: string;
}

export interface TrashContentsResponse {
  files: TrashFileItem[];
  folders: TrashFolderItem[];
}

// ---------------------------------------------------------------------------
// Shared drives types
// ---------------------------------------------------------------------------

export interface SharedDrive {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  storageUsedBytes: number;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  userRole: string;
}

export interface SharedDriveListResponse {
  drives: SharedDrive[];
  total: number;
}

// ---------------------------------------------------------------------------
// E2EE key ref types
// ---------------------------------------------------------------------------

export interface FileKeyResponse {
  fileId: string;
  userId: string;
  /** Base64url-encoded sealed-box ciphertext of the DEK. */
  encryptedFileKey: string;
  /**
   * Which version of `userId`'s keyring opens `encryptedFileKey`.
   *
   * Optional because rows written before rotation existed carry no version;
   * those are version 1 by definition, which is what `openSealedFileKey`
   * defaults to.
   */
  keyVersion?: number;
}

export interface SetFileKeyRequest {
  encryptedFileKey: string;
  /** The caller's active key version — what the DEK above was sealed to. */
  keyVersion?: number;
}

export interface ShareFileKeyRequest {
  recipientId: string;
  encryptedFileKey: string;
  /** The *recipient's* active key version, not the caller's. */
  keyVersion?: number;
}


// ---------------------------------------------------------------------------
// Notification types
// ---------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  recipientId: string;
  eventType: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Tag types
// ---------------------------------------------------------------------------

/**
 * A private, per-user label. Tags are never visible to other collaborators,
 * even on a shared file — and tag names are stored server-side in plaintext,
 * unlike E2EE file content.
 */
export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  /** Non-trashed files carrying this tag. Drives "most used first" ordering. */
  fileCount: number;
}

export interface ListTagsResponse {
  tags: Tag[];
  total: number;
}

export interface CreateTagRequest {
  name: string;
}

export interface UpdateTagRequest {
  name: string;
}

export interface SetFileTagsRequest {
  tagIds: string[];
}

/** Shaped identically to `FileItem` so tagged files feed the same grid. */
export type TaggedFile = FileItem;

export interface ListTaggedFilesResponse {
  files: TaggedFile[];
  total: number;
  limit: number;
  offset: number;
}
