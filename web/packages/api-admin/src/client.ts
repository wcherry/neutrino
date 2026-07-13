import { request } from '@neutrino/api-core';
import type {
  ProcessInfo,
  DiskUsageInfo,
  ServiceInfo,
  AdminUser,
  AdminUserListResponse,
  UpdateAdminUserRequest,
  FeatureFlag,
  UpdateFeatureFlagRequest,
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
   */
  async listUsers(page = 1, pageSize = 20): Promise<AdminUserListResponse> {
    return request<AdminUserListResponse>(
      `/api/v1/admin/users?page=${page}&pageSize=${pageSize}`,
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
   * List all feature flags with metadata.
   * GET /api/v1/admin/feature-flags
   */
  async listFeatureFlags(): Promise<FeatureFlag[]> {
    return request<FeatureFlag[]>('/api/v1/admin/feature-flags');
  },

  /**
   * Enable or disable a feature flag.
   * PATCH /api/v1/admin/feature-flags/{key}
   */
  async updateFeatureFlag(key: string, updates: UpdateFeatureFlagRequest): Promise<FeatureFlag> {
    return request<FeatureFlag>(`/api/v1/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: 'PATCH',
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
    formData.append('file', file);
    formData.append('display_name', displayName);
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
