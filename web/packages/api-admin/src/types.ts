// ---------------------------------------------------------------------------
// Admin API types
//
// These mirror the Rust structs in neutrino-drive/src/admin/service.rs and
// neutrino-drive/src/service_registry/mod.rs (all serde rename_all = "camelCase").
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: number;
  name: string;
  status: string;
  cpuPercent: number;
  memoryRssKb: number;
  openFiles: number;
}

export interface PathUsage {
  path: string;
  usedBytes: number;
  percent: number;
}

export interface DiskUsageInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  paths: PathUsage[];
}

export interface ServiceInfo {
  name: string;
  endpoint: string;
  version: string;
  healthCheckUrl: string;
  registeredAt: string;
  enabled: boolean;
  autoUpdate: boolean;
}

export interface UpdateServiceRequest {
  enabled?: boolean;
  autoUpdate?: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  createdAt: string;
  deletedAt: string | null;
  /**
   * When the background worker becomes free to erase this account for good.
   * `null` for a live account. Comes from the server so the console's countdown
   * follows the retention policy rather than a second copy of it here.
   */
  purgeAfter: string | null;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAdminUserRequest {
  name?: string;
  role?: string;
  totpEnabled?: boolean;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
}

export interface UpdateFeatureFlagRequest {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// File version retention
//
// Mirrors VersionRetentionDto in
// neutrino-drive/src/drive/version_retention/api.rs.
//
// The policy the background worker enforces on file version history, not a
// preference the frontend acts on: nothing in the browser prunes anything.
// ---------------------------------------------------------------------------

export interface VersionRetentionSettings {
  /** Whether the worker prunes version history at all. */
  enabled: boolean;
  /** Versions older than this many days are eligible for deletion. */
  retentionDays: number;
  /**
   * How many of the newest versions survive regardless of age. Read together
   * with `retentionDays` — age only decides among the versions this number has
   * not already spoken for.
   */
  minVersions: number;
  updatedAt: string;
}

/** Every field optional: send only what changed. */
export interface UpdateVersionRetentionRequest {
  enabled?: boolean;
  retentionDays?: number;
  minVersions?: number;
}

// Mirrors JobResponse in src/jobs/dto.rs (serde rename_all = "camelCase").
export interface JobResponse {
  id: string;
  jobType: string;
  payload: unknown;
  status: string;
  errorMessage: string | null;
  workerId: string | null;
  timeoutSecs: number;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Custom fonts (feature/custom-fonts)
//
// Mirrors CustomFontRecord in neutrino-drive/src/drive/fonts/model.rs
// (serde rename_all = "camelCase").
// ---------------------------------------------------------------------------

export type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';

export interface CustomFont {
  id: string;
  displayName: string;
  format: FontFormat;
  fileUrl: string;
  uploadedBy: string;
  createdAt: string;
}
