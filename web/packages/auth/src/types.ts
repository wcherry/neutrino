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
}

export interface SetPublicKeyRequest {
  /** Base64url-encoded Curve25519 public key. */
  publicKey: string;
}
