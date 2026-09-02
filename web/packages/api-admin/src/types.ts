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
  /**
   * When an admin locked the account out; `null` for a live account. Distinct
   * from `deletedAt`: a disabled account is still listed and still owns its
   * files, and is let back in by clearing this.
   */
  disabledAt: string | null;
  /** When the password was last set. `null` if it predates the column. */
  passwordChangedAt: string | null;
  /**
   * Whether sign-in currently refuses this password — an admin forced it to
   * expire, or the policy's maximum age has passed. Computed on the server, so
   * the console does not carry a second copy of either rule.
   */
  passwordExpired: boolean;
  /** When it expires under the policy's maximum age; `null` when it does not. */
  passwordExpiresAt: string | null;
  /**
   * When the run of failed sign-ins reached the policy's threshold and the
   * account locked itself. `null` normally. Reported apart from `disabledAt`
   * because a lockout a counter applied and a lockout an admin decided are
   * undone by different things — Unlock and Enable respectively.
   */
  lockedOutAt: string | null;
  /** Consecutive failed sign-ins so far, against the policy's threshold. */
  failedLoginAttempts: number;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

/** Every field optional: send only what changed. */
export interface UpdateAdminUserRequest {
  name?: string;
  role?: string;
  /** Only `false` does anything — an admin can force 2FA off, not enrol it. */
  totpEnabled?: boolean;
  /** Lock the account out, or let it back in. Disabling ends every session. */
  disabled?: boolean;
  /** Force the password to expire, or withdraw a forced expiry. */
  expirePassword?: boolean;
  /** Set a new password on the user's behalf. Ends every session. */
  password?: string;
  /**
   * Release an account the failed-sign-in threshold locked, clearing the count
   * with it. Only `true` does anything — a lockout is never applied by hand.
   */
  unlock?: boolean;
}

/**
 * Create a fully registered account — the same thing self-serve registration
 * produces, not an invitation to be completed later.
 */
export interface CreateAdminUserRequest {
  email: string;
  name: string;
  password: string;
  /** `user` or `admin`. Defaults to `user`. */
  role?: string;
  /**
   * Expire the password immediately, so the account must choose its own before
   * it can sign in. The admin knows the one they typed, so this is normally on.
   */
  requirePasswordChange?: boolean;
}

// ---------------------------------------------------------------------------
// Per-user storage quota
//
// Mirrors UserQuotaDto in src/drive/quota_requests/api.rs.
// ---------------------------------------------------------------------------

export interface UserQuota {
  userId: string;
  /** Occupancy, recomputed from the file and version rows on every read. */
  usedBytes: number;
  /** `null` means unlimited. */
  quotaBytes: number | null;
  /** `null` means unlimited. */
  dailyCapBytes: number | null;
  dailyUploadBytes: number;
}

/**
 * Replaces the user's limits rather than patching them — `null` means
 * unlimited, and a field left out is a field set to unlimited. Read the current
 * quota first and send both.
 */
export interface SetUserQuotaRequest {
  quotaBytes: number | null;
  dailyCapBytes: number | null;
}

// ---------------------------------------------------------------------------
// Storage requests — the admin work queue (issue #144)
//
// Mirrors QuotaRequestDto in src/drive/quota_requests/api.rs.
// ---------------------------------------------------------------------------

export type QuotaRequestStatus = 'pending' | 'approved' | 'denied';

export interface QuotaRequest {
  id: string;
  userId: string;
  /** The new total limit asked for, in bytes — not an increment. */
  requestedBytes: number;
  reason: string | null;
  status: QuotaRequestStatus;
  /** What was granted, which may be less than was asked for. */
  grantedBytes: number | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** Sent on the admin queue only; a user reading their own knows who they are. */
  userEmail?: string;
  userName?: string;
}

// ---------------------------------------------------------------------------
// Password policy
//
// Mirrors PasswordPolicyDto in src/auth/password_policy/api.rs.
//
// Enforced wherever a password is *set*, and by sign-in for the age and lockout
// rules. A stored hash cannot be re-checked against a tightened rule, so an
// existing password stays usable until its owner changes it or `maxAgeDays`
// expires it.
// ---------------------------------------------------------------------------

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  /** Days a password stays valid. `0` means passwords never expire on age. */
  maxAgeDays: number;
  updatedAt: string;
  /**
   * Characters a password may not contain, held as the characters themselves
   * rather than as a delimited list — a comma and a space are both plausible
   * things to forbid, so any separator would be ambiguous. Empty forbids
   * nothing.
   */
  forbiddenCharacters: string;
  /** Consecutive failed sign-ins before the account locks. `0` means never. */
  lockoutThreshold: number;
  /** How many previous passwords a new one is checked against. `0` is off. */
  historyCount: number;
}

/** Every field optional: send only what changed. */
export interface UpdatePasswordPolicyRequest {
  minLength?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireNumber?: boolean;
  requireSymbol?: boolean;
  maxAgeDays?: number;
  forbiddenCharacters?: string;
  lockoutThreshold?: number;
  historyCount?: number;
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
