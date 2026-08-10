import { request, ApiClientError, refreshTokens } from '@neutrino/api-core';
import type {
  RegisterRequest,
  LoginRequest,
  AuthTokens,
  UserProfile,
  UserProfileDetails,
  PublicProfile,
  UpdateProfileRequest,
  PublicKeyResponse,
  SetPublicKeyRequest,
  VaultResponse,
  PutVaultRequest,
  UnlockMethodInput,
  UnlockMethodResponse,
} from './types';

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export const authApi = {
  async register(body: RegisterRequest): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async login(body: LoginRequest): Promise<AuthTokens> {
    const tokens = await request<AuthTokens>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.accessToken);
      localStorage.setItem('refresh_token', tokens.refreshToken);
    }
    return tokens;
  },

  async refresh(refreshToken?: string): Promise<AuthTokens> {
    const token =
      refreshToken ??
      (typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null);
    if (!token || token === 'undefined' || token === 'null') {
      throw new ApiClientError(401, 'NO_REFRESH_TOKEN', 'No refresh token available');
    }
    const tokens = await refreshTokens(token);
    if (!tokens) {
      throw new ApiClientError(401, 'REFRESH_FAILED', 'Unable to refresh session');
    }
    return tokens;
  },

  async logout(): Promise<void> {
    try {
      await request<void>('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      }
    }
  },

  async getProfile(): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/auth/me');
  },

  async getProfileDetails(): Promise<UserProfileDetails> {
    return request<UserProfileDetails>('/api/v1/auth/profile');
  },

  async updateProfileDetails(body: UpdateProfileRequest): Promise<UserProfileDetails> {
    return request<UserProfileDetails>('/api/v1/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async getPublicProfile(userId: string): Promise<PublicProfile> {
    return request<PublicProfile>(`/api/v1/auth/users/${userId}/profile`);
  },

  isAuthenticated(): boolean {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem('access_token');
  },

  // ── E2EE key management ────────────────────────────────────────────────────

  /** Upload the caller's Curve25519 public key to the server. */
  async setPublicKey(body: SetPublicKeyRequest): Promise<PublicKeyResponse> {
    return request<PublicKeyResponse>('/api/v1/auth/keys', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Fetch the Curve25519 public key for any user (needed before sharing). */
  async getUserPublicKey(userId: string): Promise<PublicKeyResponse | null> {
    try {
      return await request<PublicKeyResponse>(`/api/v1/auth/users/${userId}/public-key`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  // ── Key vault ──────────────────────────────────────────────────────────────

  /** The caller's wrapped identity key, or null if they have no vault yet. */
  async getVault(): Promise<VaultResponse | null> {
    try {
      return await request<VaultResponse>('/api/v1/auth/keyvault');
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  /** Create or replace the vault. Replacing drops every existing unlock method. */
  async putVault(body: PutVaultRequest): Promise<VaultResponse> {
    return request<VaultResponse>('/api/v1/auth/keyvault', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async addUnlockMethod(body: UnlockMethodInput): Promise<UnlockMethodResponse> {
    return request<UnlockMethodResponse>('/api/v1/auth/keyvault/unlocks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Revoke an unlock method. The server refuses to remove the last one. */
  async removeUnlockMethod(id: string): Promise<void> {
    await request<void>(`/api/v1/auth/keyvault/unlocks/${id}`, { method: 'DELETE' });
  },

  /** Record a successful unlock, for the "last used" column in settings. */
  async markUnlockMethodUsed(id: string): Promise<void> {
    try {
      await request<void>(`/api/v1/auth/keyvault/unlocks/${id}/used`, { method: 'POST' });
    } catch {
      // Bookkeeping only — never fail an unlock because this did not land.
    }
  },
};
