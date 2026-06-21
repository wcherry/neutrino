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
}

export type DriveView = 'recent' | 'starred' | 'trash';

export interface FileListQuery {
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  direction?: 'asc' | 'desc';
  view?: DriveView;
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
  shortcuts: unknown[];
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
  userId: string;
  name: string;
  targetId: string;
  targetType: 'file' | 'folder';
  createdAt: string;
}

export interface ShortcutCreateRequest {
  targetId: string;
  targetType: 'file' | 'folder';
  name?: string;
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
}

export interface SetFileKeyRequest {
  encryptedFileKey: string;
}

export interface ShareFileKeyRequest {
  recipientId: string;
  encryptedFileKey: string;
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
