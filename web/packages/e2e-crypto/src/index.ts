export {
  initSodium,
  generateKeyPair,
  generateFileKey,
  encryptFile,
  decryptFile,
  encryptFileKey,
  decryptFileKey,
  encryptMetadata,
  decryptMetadata,
  encryptKeysWithPin,
  decryptKeysWithPin,
  toBase64url,
  toBase64,
  type KeyPair,
  type PinEncryptedKeys,
} from './crypto';

export {
  loadKeyPair,
  saveKeyPair,
  clearKeyPair,
  hasKeyPair,
  readLegacyKeyPair,
  hasLegacyKeyPair,
  clearLegacyKeyPair,
  fromBase64url,
  fromBase64,
  type StoredKeyPair,
} from './keystore';

export {
  subscribeToLockState,
  isUnlocked,
  clearSession,
  setSessionKeyPair,
  getSessionKeyPair,
  setSessionMasterKey,
  getSessionMasterKey,
  type SessionKeyPair,
} from './session';

export {
  generateMasterKey,
  wrapIdentity,
  unwrapIdentity,
  openVault,
  buildSecretUnlock,
  buildPasskeyUnlock,
  unwrapWithSecret,
  unwrapWithPasskey,
  toBase64urlBytes,
  fromBase64urlBytes,
  type UnlockMethod,
  type UnlockMethodBlob,
  type VaultBundle,
} from './vault';

export {
  isPasskeySupported,
  registerPasskey,
  getPasskeyPrf,
  type PasskeyParams,
} from './prf';

export {
  deriveKek,
  newArgon2Params,
  DEFAULT_ARGON2_PARAMS,
  type Argon2Params,
} from './kdf';

export {
  generateRecoveryCode,
  normalizeRecoveryCode,
  looksLikeRecoveryCode,
} from './recovery';
