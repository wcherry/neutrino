// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Set a new password by proving knowledge of the current one.
 *
 * Deliberately not an authenticated call: sign-in refuses an expired password
 * with `PASSWORD_EXPIRED` and issues no tokens, so this is the only way out of
 * that state. The proof is the same one sign-in takes.
 */
export interface ChangePasswordRequest {
  email: string;
  currentPassword: string;
  newPassword: string;
  /** Required when the account has two-factor enabled, exactly as at sign-in. */
  totpCode?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  role?: string;
  /** Derived from the `role` field returned by /me. */
  isAdmin?: boolean;
}

export interface SocialLinks {
  [platform: string]: string;
}

export interface EmailPreferences {
  marketing: boolean;
  general: boolean;
  updates: boolean;
  critical: boolean;
}

/** Full profile details returned for the authenticated user's own profile. */
export interface UserProfileDetails {
  userId: string;
  theme: string | null;
  bio: string | null;
  avatar: string | null;
  profileImage: string | null;
  website: string | null;
  socialLinks: SocialLinks;
  language: string | null;
  timezone: string | null;
  country: string | null;
  emailPreferences: EmailPreferences;
}

/** Subset of profile data visible to any authenticated user. */
export interface PublicProfile {
  userId: string;
  name: string;
  bio: string | null;
  avatar: string | null;
  profileImage: string | null;
  website: string | null;
  socialLinks: SocialLinks;
  language: string | null;
  country: string | null;
}

export interface UpdateProfileRequest {
  /**
   * Display name. Stored on the user record rather than the profile record, so
   * it is not echoed back in `UserProfileDetails` — re-read it with
   * `useAuth().refresh()` after a save.
   */
  name?: string;
  theme?: string | null;
  bio?: string | null;
  avatar?: string | null;
  profileImage?: string | null;
  website?: string | null;
  socialLinks?: SocialLinks;
  language?: string | null;
  timezone?: string | null;
  country?: string | null;
  emailPreferences?: EmailPreferences;
}

// ---------------------------------------------------------------------------
// E2EE key types
// ---------------------------------------------------------------------------

export interface PublicKeyResponse {
  userId: string;
  /** Base64url-encoded Curve25519 public key. */
  publicKey: string;
  /** Which entry of the user's keyring this is. */
  version: number;
}

export interface SetPublicKeyRequest {
  /** Base64url-encoded Curve25519 public key. */
  publicKey: string;
}

/** One published version of a user's identity key. */
export interface PublicKeyVersion {
  version: number;
  publicKey: string;
  createdAt: string;
  /** Null for the active version. */
  retiredAt: string | null;
}

/**
 * A user's whole published keyring.
 *
 * Public halves only. Needed to seal to someone's *current* key while still
 * being able to recognise the ones they have rotated away from.
 */
export interface PublicKeyRingResponse {
  userId: string;
  /** Oldest first. */
  keys: PublicKeyVersion[];
  /** The version new work should be sealed to. */
  activeVersion: number | null;
}
