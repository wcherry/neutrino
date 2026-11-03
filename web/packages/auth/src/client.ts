import { request, ApiClientError, refreshTokens, refreshTokensOnce } from '@neutrino/api-core';
import { emitAuthChanged } from './authEvents';
import type {
  RegisterRequest,
  SignupPolicy,
  LoginRequest,
  ChangePasswordRequest,
  PasswordResetCheck,
  EmailVerificationStatus,
  ResetPasswordRequest,
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

let profileInFlight: Promise<UserProfile> | null = null;

export const authApi = {
  async register(body: RegisterRequest): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Whether this server takes sign-ups without an invite. Unauthenticated. */
  async signupPolicy(): Promise<SignupPolicy> {
    return request<SignupPolicy>('/api/v1/auth/signup-policy');
  },

  /**
   * Set a new password, proving knowledge of the current one.
   *
   * Unauthenticated, and that is the point: a password sign-in has refused as
   * expired gets no tokens, so an authenticated change would leave the account
   * with no way back in. Succeeding signs every device out, so the caller signs
   * in again with the new password rather than being handed a session here.
   */
  async changePassword(body: ChangePasswordRequest): Promise<void> {
    return request<void>('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Ask for a password reset link to be emailed to `email`.
   *
   * Resolves the same way whether or not the address has an account, so the
   * caller cannot tell — and must not try to.
   */
  async forgotPassword(email: string): Promise<void> {
    return request<void>(
      '/api/v1/auth/password/forgot',
      { method: 'POST', body: JSON.stringify({ email }) },
      { auth: 'none', responseType: 'none' },
    );
  },

  /**
   * Check an emailed reset link before asking for a new password. Rejects with
   * `RESET_NOT_FOUND`, `RESET_REVOKED`, `RESET_USED`, `RESET_EXPIRED` or
   * `ACCOUNT_DISABLED`.
   */
  async checkPasswordReset(token: string): Promise<PasswordResetCheck> {
    return request<PasswordResetCheck>(
      '/api/v1/auth/password/reset/check',
      { method: 'POST', body: JSON.stringify({ token }) },
      { auth: 'none' },
    );
  },

  /**
   * Set a new password with an emailed reset link. Every device is signed out,
   * so the caller sends the user to sign in rather than holding a session.
   */
  async resetPassword(body: ResetPasswordRequest): Promise<void> {
    return request<void>(
      '/api/v1/auth/password/reset',
      { method: 'POST', body: JSON.stringify(body) },
      { auth: 'none' },
    );
  },

  /**
   * Follow an emailed verification link. Rejects with `VERIFY_NOT_FOUND`,
   * `VERIFY_REVOKED`, `VERIFY_USED` or `VERIFY_EXPIRED`.
   */
  async verifyEmail(token: string): Promise<{ email: string }> {
    return request<{ email: string }>(
      '/api/v1/auth/email/verify',
      { method: 'POST', body: JSON.stringify({ token }) },
      { auth: 'none' },
    );
  },

  /** Where the signed-in account's address stands, for the banner. */
  async getEmailVerification(): Promise<EmailVerificationStatus> {
    return request<EmailVerificationStatus>('/api/v1/auth/email/verification');
  },

  /**
   * Mail the signed-in account a new verification link. Rejects with
   * `TOO_MANY_REQUESTS` after three in an hour.
   */
  async resendEmailVerification(): Promise<void> {
    return request<void>(
      '/api/v1/auth/email/verification/resend',
      { method: 'POST' },
      { responseType: 'none' },
    );
  },

  /**
   * Ask for a verification link for the account at `email`, from the sign-in
   * page, when the account can no longer sign in to ask. Always succeeds,
   * account or not.
   */
  async requestEmailVerification(email: string): Promise<void> {
    return request<void>(
      '/api/v1/auth/email/verification/request',
      { method: 'POST', body: JSON.stringify({ email }) },
      { auth: 'none', responseType: 'none' },
    );
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

  /**
   * The signed-in user. Concurrent calls share one request: the auth provider and the app shell
   * both ask at startup, and a second `/auth/me` on the critical path of every page load was a
   * round trip for an answer already on its way. Calls after it settles fetch afresh.
   */
  getProfile(): Promise<UserProfile> {
    if (!profileInFlight) {
      profileInFlight = request<UserProfile>('/api/v1/auth/me').finally(() => {
        profileInFlight = null;
      });
    }
    return profileInFlight;
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
