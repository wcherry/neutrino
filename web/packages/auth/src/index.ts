export { authApi } from './client';
export { AuthProvider, useAuth, useUser } from './context';
export { ensureE2EKeys } from './e2e-keys';
export { AUTH_COOKIE_NAME, SIGN_IN_PATH, PROTECTED_PATHS } from './middleware';
export { decodeJwtAdmin, isCurrentUserAdmin } from './adminUtils';

export type {
  RegisterRequest,
  LoginRequest,
  AuthTokens,
  RefreshRequest,
  UserProfile,
  UserProfileDetails,
  PublicProfile,
  SocialLinks,
  EmailPreferences,
  UpdateProfileRequest,
  PublicKeyResponse,
  SetPublicKeyRequest,
} from './types';
