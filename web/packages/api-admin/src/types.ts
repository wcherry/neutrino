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
