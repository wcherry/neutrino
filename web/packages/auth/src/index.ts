export { authApi } from './client';
export { AuthProvider, useAuth, useUser } from './context';
export { emitAuthChanged, subscribeToAuthChanged } from './authEvents';
export {
  getVaultState,
  provisionVault,
  unlockWithPassword,
  unlockWithPasskey,
  unlockWithRecoveryCode,
  enrollPasskey,
  changeVaultPassword,
  regenerateRecoveryCode,
  revokeUnlockMethod,
  replaceIdentity,
  listUnlockMethods,
  ensurePublicKeyRegistered,
  type VaultState,
  type ProvisionResult,
} from './e2e-keys';
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
  VaultResponse,
  PutVaultRequest,
  UnlockMethodInput,
  UnlockMethodResponse,
} from './types';
