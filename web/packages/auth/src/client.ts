import { request, ApiClientError, refreshTokens, refreshTokensOnce } from '@neutrino/api-core';
import { emitAuthChanged } from './authEvents';
import type {
  RegisterRequest,
  LoginRequest,
  AuthTokens,
  UserProfile,
  UserProfileDetails,
  PublicProfile,
  UpdateProfileRequest,
  PublicKeyResponse,
  PublicKeyRingResponse,
  SetPublicKeyRequest,
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
      // `AuthProvider` mounted before this token existed — tell it to load the
      // profile, or every `useAuth()` consumer stays signed-out until a reload.
      emitAuthChanged();
    }
    return tokens;
  },

  /**
   * Refresh the session by hand, for the caller that has to do it outside a
   * request — `(apps)/layout.tsx` on a cold load.
   *
   * With no token given this goes through `refreshTokensOnce`, which shares one
   * refresh with whatever `request()` has already started. Rotation spends the
   * token, so two independent refreshes are a race the loser used to answer by
   * signing the user out — see `refreshTokens`.
   */
  async refresh(refreshToken?: string): Promise<AuthTokens> {
    const token =
      refreshToken ??
      (typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null);
    if (!token || token === 'undefined' || token === 'null') {
      throw new ApiClientError(401, 'NO_REFRESH_TOKEN', 'No refresh token available');
    }
    const tokens = refreshToken ? await refreshTokens(refreshToken) : await refreshTokensOnce();
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
        emitAuthChanged();
      }
    }
  },

  /**
   * Deletes the signed-in account, then clears the session the way `logout`
   * does — the access token stays cryptographically valid until it expires, so
   * leaving it in `localStorage` would keep the app rendering for an account
   * that no longer exists until the next 401.
   *
   * Unlike `logout` the tokens are only dropped on success: a failed delete
   * has to leave the user signed in, or they are thrown out of an account they
   * still have.
   */
  async deleteAccount(): Promise<void> {
    await request<void>('/api/v1/auth/me', { method: 'DELETE' });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      emitAuthChanged();
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

  /**
   * Fetch a user's *active* Curve25519 public key — what a new DEK is sealed to.
   *
   * Carries the key's version so the caller can record it on the key ref; a
   * file's `keyVersion` is what says which secret key opens it later.
   */
  async getUserPublicKey(userId: string): Promise<PublicKeyResponse | null> {
    try {
      return await request<PublicKeyResponse>(`/api/v1/auth/users/${userId}/public-key`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  /** Fetch a user's full published keyring, including retired versions. */
  async getUserPublicKeys(userId: string): Promise<PublicKeyRingResponse> {
    return request<PublicKeyRingResponse>(`/api/v1/auth/users/${userId}/public-keys`);
  },

};
