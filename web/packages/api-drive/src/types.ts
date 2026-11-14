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
  /**
   * Relative URL of the file's cover thumbnail, or null when it has none.
   *
   * Not the bytes: a page of files used to carry a base64 thumbnail per row —
   * ~37KB each, several megabytes for a grid of photos, and uncacheable
   * because it arrived inside a JSON body with no URL of its own (issue #175).
   * Pass it through `driveApi.getThumbnailUrl` to get something an `<img>` can
   * load; the `v` it already carries is what busts the cache when the
   * thumbnail changes.
   */
  coverThumbnailUrl: string | null;
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
  /** Relative URL of the file's cover thumbnail — see `FileItem.coverThumbnailUrl`. */
  coverThumbnailUrl: string | null;
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

/**
 * Filter drive contents to a single kind of file, matched by MIME type.
 *
 * Mirrors `DriveFileType` in `src/drive/filesystem/dto.rs`, and like it holds
 * two generations. The **per-app types** are what the iOS apps ask for (Photos
 * for `photo`/`video`, Docs/Sheets/Slides for their own native MIME) and are
 * pinned by shipped builds. The **categories** are coarser groupings, and are
 * what the Drive filter chips send; they partition a drive, so a file answers
 * to exactly one of them.
 */
export type DriveFileType =
  // Per-app types
  | 'photo'
  | 'video'
  | 'audio'
  | 'document'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'diagram'
  | 'drawing'
  | 'note'
  // Categories
  | 'media'
  | 'office'
  | 'canvas'
  | 'pdf'
  | 'archive'
  | 'code';

export interface FileListQuery {
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  direction?: 'asc' | 'desc';
  /**
   * Narrow the listing to one kind of file. Answered in SQL against the
   * category's MIME patterns, and — on the flat `/drive/files` listing —
   * across the whole drive rather than one folder.
   */
  type?: DriveFileType;
}

export interface QuotaInfo {
  usedBytes: number;
  dailyUploadBytes: number;
  dailyResetAt: string;
  quotaBytes: number | null;
  dailyCapBytes: number | null;
}

/**
 * One ask for a bigger storage limit, and what was decided about it (issue #144).
 *
 * The admin console owns the queue these land in; this is the asker's own view,
 * so the storage meter can say "awaiting review" rather than offering to ask
 * again, and can report the answer when it comes.
 */
export interface QuotaRequestItem {
  id: string;
  userId: string;
  /** The new total limit asked for, in bytes — not an increment. */
  requestedBytes: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  /** What was granted, which may be less than was asked for. */
  grantedBytes: number | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
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
  /** Whether opening the link needs a password. The password itself is never returned. */
  hasPassword?: boolean;
  /** base64url X25519 public half of the link key (#321), when the link has one. */
  publicKey?: string | null;
  /** The recipient id file keys are sealed to for this link: `guest:{id}`. */
  keySubject?: string;
  /** The link key seed sealed to the owner, so the owner can rebuild the full URL. */
  sealedSeed?: string | null;
  sealedSeedKeyVersion?: number | null;
}

export interface UpsertShareLinkRequest {
  visibility?: 'public' | 'anyoneWithLink';
  role?: 'viewer' | 'commenter' | 'editor';
  expiresAt?: string | null;
  /** Require this password to open the link. */
  password?: string;
  /** base64url link public key; its seed goes in the link's URL fragment. */
  publicKey?: string;
  /** The seed sealed to the owner's own public key, and which key version opens it. */
  sealedSeed?: string;
  sealedSeedKeyVersion?: number;
}

export interface UpdateShareLinkRequest {
  visibility?: 'public' | 'anyoneWithLink';
  role?: 'viewer' | 'commenter' | 'editor';
  expiresAt?: string | null;
  isActive?: boolean;
  /** Set or change the password; `null` removes it. Any change ends open guest sessions. */
  password?: string | null;
  /** Replace the link public key; `null` removes it. */
  publicKey?: string | null;
  /** Replace the owner-sealed seed (with its key version); `null` removes it. */
  sealedSeed?: string | null;
  sealedSeedKeyVersion?: number;
}

export interface ResolvedShareLink {
  /**
   * True when the link needs a password. Until a session is opened with it, the server withholds
   * everything but `resourceType` (empty strings and nulls).
   */
  passwordRequired?: boolean;
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
  resourceType: string;
  resourceId: string;
  resourceName: string;
  /** The recipient id this link's file keys are sealed to (`guest:{link id}`). */
  keySubject: string;
  /** The link public key, to check the URL fragment's key against before using it. */
  publicKey: string | null;
}

/** Someone a new file's key must be sealed to (`GET /drive/folders/{id}/key-recipients`). */
export interface KeyRecipient {
  recipientId: string;
  kind: 'owner' | 'link';
  publicKey: string;
  keyVersion: number;
}

export interface UnkeyedFilesResponse {
  keySubject: string;
  publicKey: string | null;
  fileIds: string[];
  hasMore: boolean;
}

/** `GET /share/folder/{id}`: a folder as a link guest sees it. */
export interface LinkFolderContents extends FolderContentsResponse {
  /** The shared folder: the top of what the guest can reach. */
  rootFolderId: string;
  role: 'viewer' | 'commenter' | 'editor';
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
  /** The file or folder's name, on the owner's pending list. */
  resourceName?: string;
  /** The file's MIME type, on the owner's pending list. */
  mimeType?: string;
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
// Key file types — the caller's retired identity keys
// ---------------------------------------------------------------------------

/**
 * One retired key. `encryptedKey` is opaque to the server: a sealed box that
 * `@neutrino/e2e-crypto`'s `buildKeyFile` wrapped to the keyring's active public
 * key, so only the holder of the current identity can open it.
 */
export interface ArchivedKey {
  keyVersion: number;
  /** Base64url. Never plaintext — the server holds no key that opens it. */
  encryptedKey: string;
  /** Base64url public half, so a client can match an entry before unsealing. */
  publicKey?: string;
}

export interface PutKeyFileRequest {
  /**
   * The complete set, not a delta: the server replaces rather than merges, so
   * omitting an entry here is how a key is retired for good.
   */
  keys: ArchivedKey[];
}

export interface KeyFileResponse {
  userId: string;
  /** Ascending by `keyVersion`, whatever order they were sent in. */
  keys: ArchivedKey[];
  createdAt: string;
  updatedAt: string;
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
