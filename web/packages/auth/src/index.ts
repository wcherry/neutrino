export { authApi } from './client';
export { AuthProvider, useAuth, useUser } from './context';
export { emitAuthChanged, subscribeToAuthChanged } from './authEvents';
export {
  getKeyringState,
  provisionKeyring,
  adoptKeyring,
  adoptKeyPair,
  unlockKeyring,
  restoreFromRecoveryKit,
  rotateIdentity,
  currentRecoveryKit,
  deviceHoldsKeyring,
  forgetThisDevice,
  type KeyringState,
  type KeyringStatus,
  type ProvisionResult,
  type RotationResult,
  type WrapMethod,
  type LocalKeystoreInfo,
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
  PublicKeyVersion,
  PublicKeyRingResponse,
  SetPublicKeyRequest,
} from './types';
