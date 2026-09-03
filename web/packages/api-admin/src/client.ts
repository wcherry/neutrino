import { request } from '@neutrino/api-core';
import type {
  ProcessInfo,
  DiskUsageInfo,
  ServiceInfo,
  AdminUser,
  AdminUserListResponse,
  UpdateAdminUserRequest,
  CreateAdminUserRequest,
  UserQuota,
  SetUserQuotaRequest,
  QuotaRequest,
  QuotaRequestStatus,
  PasswordPolicy,
  UpdatePasswordPolicyRequest,
  VersionRetentionSettings,
  UpdateVersionRetentionRequest,
  JobResponse,
  CustomFont,
} from './types';

// ---------------------------------------------------------------------------
// Admin API
//
// All endpoints require a JWT with is_admin: true.
// Routes live under /api/v1/admin/* (served by neutrino-drive).
// ---------------------------------------------------------------------------

export const adminApi = {
  /**
   * Return a list of running processes on the server.
   * GET /api/v1/admin/processes
   */
  async getProcesses(): Promise<ProcessInfo[]> {
    return request<ProcessInfo[]>('/api/v1/admin/processes');
  },

  /**
   * Return disk usage statistics for the configured storage path.
   * GET /api/v1/admin/disk
   */
  async getDisk(): Promise<DiskUsageInfo> {
    return request<DiskUsageInfo>('/api/v1/admin/disk');
  },

  /**
   * Return all registered services with their enabled/disabled status.
   * GET /api/v1/admin/services
   */
  async listServices(): Promise<ServiceInfo[]> {
    return request<ServiceInfo[]>('/api/v1/admin/services');
  },

  /**
   * Toggle a service's enabled flag (or auto_update flag).
   * PATCH /api/v1/admin/services/{name}
   */
  async updateService(
    name: string,
    enabled?: boolean,
    autoUpdate?: boolean,
  ): Promise<ServiceInfo> {
    const body: Record<string, boolean> = {};
    if (enabled !== undefined) body.enabled = enabled;
    if (autoUpdate !== undefined) body.autoUpdate = autoUpdate;
    return request<ServiceInfo>(`/api/v1/admin/services/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  /**
   * List all users (paginated).
   * GET /api/v1/admin/users
   *
   * `includeDeleted` widens the listing to soft-deleted accounts, which every
   * other endpoint hides. They are only visible here so an admin can restore
   * one before the worker erases it.
   */
  async listUsers(page = 1, pageSize = 20, includeDeleted = false): Promise<AdminUserListResponse> {
    const params = `page=${page}&pageSize=${pageSize}`;
    return request<AdminUserListResponse>(
      `/api/v1/admin/users?${params}${includeDeleted ? '&includeDeleted=true' : ''}`,
    );
  },

  /**
   * Get a single user by ID.
   * GET /api/v1/admin/users/{userId}
   */
  async getUser(userId: string): Promise<AdminUser> {
    return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`);
  },

  /**
   * Create a fully registered account.
   * POST /api/v1/admin/users
   *
   * Not an invitation: the account can sign in with the password given here.
   * `requirePasswordChange` expires that password immediately, which is what
   * stops the one the admin typed staying the account's password.
   */
  async createUser(body: CreateAdminUserRequest): Promise<{ id: string; email: string; name: string }> {
    return request<{ id: string; email: string; name: string }>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Update a user's name, role, or 2FA status.
   * PATCH /api/v1/admin/users/{userId}
   */
  async updateUser(userId: string, updates: UpdateAdminUserRequest): Promise<AdminUser> {
    return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  /**
   * Delete a user account.
   * DELETE /api/v1/admin/users/{userId}
   */
  async deleteUser(userId: string): Promise<void> {
    return request<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Undo a soft delete, whether the user or an admin performed it.
   * POST /api/v1/admin/users/{userId}/restore
   *
   * Only works inside the retention window: once the worker has purged the
   * account there is no row left and this 404s.
   */
  async restoreUser(userId: string): Promise<AdminUser> {
    return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}/restore`, {
      method: 'POST',
    });
  },

  // ── Storage quotas ────────────────────────────────────────────────────────

  /**
   * Read the quotas of several users at once.
   * GET /api/v1/admin/quotas?userIds=a,b,c
   *
   * One request for the page of users on screen rather than one per row. Ids
   * with no quota row yet come back with the defaults they would be created
   * with, so every row on the page has something to show.
   */
  async listQuotas(userIds: string[]): Promise<UserQuota[]> {
    if (userIds.length === 0) return [];
    const ids = encodeURIComponent(userIds.join(','));
    return request<UserQuota[]>(`/api/v1/admin/quotas?userIds=${ids}`);
  },

  /**
   * Read one user's storage limits and occupancy.
   * GET /api/v1/admin/users/{userId}/quota
   */
  async getUserQuota(userId: string): Promise<UserQuota> {
    return request<UserQuota>(`/api/v1/admin/users/${encodeURIComponent(userId)}/quota`);
  },

  /**
   * Set one user's storage limit and daily upload cap.
   * PUT /api/v1/admin/users/{userId}/quota
   *
   * Replaces both — `null` is unlimited. A limit below what the account already
   * stores is allowed: nothing is deleted, but they cannot upload again until
   * they are back under it.
   */
  async setUserQuota(userId: string, body: SetUserQuotaRequest): Promise<UserQuota> {
    return request<UserQuota>(`/api/v1/admin/users/${encodeURIComponent(userId)}/quota`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  // ── Work queue: storage requests (issue #144) ─────────────────────────────

  /**
   * The storage-request queue, oldest first.
   * GET /api/v1/admin/quota-requests?status=…
   *
   * Defaults to the pending ones — the requests that are actually work.
   */
  async listQuotaRequests(status: QuotaRequestStatus | 'all' = 'pending'): Promise<QuotaRequest[]> {
    return request<QuotaRequest[]>(`/api/v1/admin/quota-requests?status=${status}`);
  },

  /**
   * Approve a request and raise the user's limit.
   * POST /api/v1/admin/quota-requests/{id}/approve
   *
   * `grantedBytes` may be less than was asked for; omitted, the request is
   * granted in full.
   */
  async approveQuotaRequest(
    id: string,
    body: { grantedBytes?: number; note?: string } = {},
  ): Promise<QuotaRequest> {
    return request<QuotaRequest>(
      `/api/v1/admin/quota-requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /**
   * Deny a request, leaving the user's quota as it is.
   * POST /api/v1/admin/quota-requests/{id}/deny
   */
  async denyQuotaRequest(id: string, body: { note?: string } = {}): Promise<QuotaRequest> {
    return request<QuotaRequest>(
      `/api/v1/admin/quota-requests/${encodeURIComponent(id)}/deny`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  // ── Password policy ───────────────────────────────────────────────────────

  /**
   * Read the workspace password policy.
   * GET /api/v1/admin/password-policy
   */
  async getPasswordPolicy(): Promise<PasswordPolicy> {
    return request<PasswordPolicy>('/api/v1/admin/password-policy');
  },

  /**
   * Change the workspace password policy.
   * PUT /api/v1/admin/password-policy
   *
   * Applies to the next password anyone sets. Existing passwords cannot be
   * re-checked against a tightened rule — a hash cannot be inspected — so they
   * stay usable until changed, or until `maxAgeDays` expires them.
   */
  async updatePasswordPolicy(body: UpdatePasswordPolicyRequest): Promise<PasswordPolicy> {
    return request<PasswordPolicy>('/api/v1/admin/password-policy', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  /**
   * Read the file version retention policy.
   * GET /api/v1/admin/version-retention
   */
  async getVersionRetention(): Promise<VersionRetentionSettings> {
    return request<VersionRetentionSettings>('/api/v1/admin/version-retention');
  },

  /**
   * Change the file version retention policy.
   * PUT /api/v1/admin/version-retention
   *
   * Takes effect on the worker's next hourly sweep. Lowering either number
   * makes versions eligible that were not before, and the sweep deletes them
   * for good.
   */
  async updateVersionRetention(
    updates: UpdateVersionRetentionRequest,
  ): Promise<VersionRetentionSettings> {
    return request<VersionRetentionSettings>('/api/v1/admin/version-retention', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  /**
   * List all worker jobs (newest first).
   * GET /api/v1/jobs
   */
  async listJobs(): Promise<JobResponse[]> {
    return request<JobResponse[]>('/api/v1/jobs');
  },

  /**
   * Upload a new custom font (admin-only).
   * POST /api/v1/admin/fonts
   */
  async uploadFont(file: File, displayName: string): Promise<CustomFont> {
    const formData = new FormData();
    formData.append('display_name', displayName);
    formData.append('file', file);
    return request<CustomFont>('/api/v1/admin/fonts', {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Delete a custom font (admin-only).
   * DELETE /api/v1/admin/fonts/{id}
   */
  async deleteFont(id: string): Promise<void> {
    return request<void>(`/api/v1/admin/fonts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};

// ---------------------------------------------------------------------------
// Fonts API
//
// GET /api/v1/fonts is any-authenticated-user access (not admin-gated), so it
// is kept separate from adminApi which is entirely admin-only.
// ---------------------------------------------------------------------------

export const fontsApi = {
  /**
   * List all uploaded custom fonts.
   * GET /api/v1/fonts
   */
  async list(): Promise<CustomFont[]> {
    return request<CustomFont[]>('/api/v1/fonts');
  },

  /**
   * Fetch a font's file bytes as a Blob.
   */
  async getFileBlob(fileUrl: string): Promise<Blob> {
    return request<Blob>(fileUrl, {}, { responseType: 'blob' });
  },
};
