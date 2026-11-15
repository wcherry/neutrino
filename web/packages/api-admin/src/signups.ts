import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Sign-up abuse: where recent sign-ups came from, and bulk deletion of the
// accounts a scripted sign-up wave left behind. Admin only.
// Backend: `src/auth/signup_guard/api.rs`.
// ---------------------------------------------------------------------------

export interface SignupGroup {
  /** An IP address (IPv6 as its /64) or an email domain. */
  key: string;
  total: number;
  /** How many have not verified their email address. */
  unverified: number;
}

export interface SignupSummary {
  hours: number;
  total: number;
  unverified: number;
  byIp: SignupGroup[];
  byDomain: SignupGroup[];
}

export interface BulkDeleteUsersRequest {
  ip?: string;
  emailDomain?: string;
  /** UTC, `YYYY-MM-DDTHH:MM:SS` (no zone suffix). */
  createdAfter?: string;
  createdBefore?: string;
  includeVerified?: boolean;
  /** Defaults to true server-side: deleting is always a deliberate second call. */
  dryRun?: boolean;
}

export interface BulkDeleteUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  signupIp: string | null;
}

export interface BulkDeleteUsersResponse {
  dryRun: boolean;
  matched: number;
  deleted: number;
  sample: BulkDeleteUser[];
}

/** A `Date` as the zone-less UTC timestamp the server's filters take. */
export function toServerTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19);
}

export const signupsApi = {
  /** GET /api/v1/admin/signups/summary */
  async summary(hours = 24): Promise<SignupSummary> {
    return request<SignupSummary>(`/api/v1/admin/signups/summary?hours=${hours}`);
  },

  /** POST /api/v1/admin/users/bulk-delete */
  async bulkDelete(body: BulkDeleteUsersRequest): Promise<BulkDeleteUsersResponse> {
    return request<BulkDeleteUsersResponse>('/api/v1/admin/users/bulk-delete', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
