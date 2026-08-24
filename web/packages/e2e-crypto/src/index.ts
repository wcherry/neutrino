export {
  initSodium,
  generateKeyPair,
  keyPairMatches,
  generateFileKey,
  encryptFile,
  decryptFile,
  encryptFileKey,
  decryptFileKey,
  encryptMetadata,
  decryptMetadata,
  toBase64url,
  toBase64,
  type KeyPair,
} from './crypto';

export {
  loadKeyPair,
  loadKeyPairForVersion,
  activeKeyVersion,
  clearKeyPair,
  hasKeyPair,
  openSealedFileKey,
  fromBase64url,
  fromBase64,
} from './keystore';

export {
  subscribeToLockState,
  isUnlocked,
  clearSession,
  setSessionKeyring,
  getSessionKeyring,
  getSessionKeyPair,
  getSessionKeyPairForVersion,
  getActiveKeyVersion,
  getSessionWrappingKey,
  setSessionWrappingKey,
  type SessionKeyPair,
} from './session';

export {
  createKeyring,
  keyringFromKeyPair,
  activeEntry,
  entryForVersion,
  rotateKeyring,
  serializeKeyring,
  deserializeKeyring,
  wipeKeyring,
  type Keyring,
  type KeyringEntry,
  type SerializedKeyring,
} from './keyring';

export {
  getLocalKeystoreInfo,
  hasLocalKeyring,
  storeUnderPasskey,
  storeUnderPassphrase,
  storeOnDevice,
  rewrapExisting,
  unlockWithPasskey,
  unlockWithPassphrase,
  unlockOnDevice,
  clearLocalKeyring,
  ARGON2_DEFAULTS,
  type WrapMethod,
  type LocalKeystoreInfo,
} from './keystoreLocal';

export {
  buildKeyFile,
  openKeyFile,
  type ArchivedKey,
  type RecoveredKey,
} from './keyFile';

export {
  exportRecoveryKit,
  importRecoveryKit,
  normalizeRecoveryKit,
  looksLikeRecoveryKit,
} from './recoveryKit';

export {
  createPairingSession,
  acceptPairingResponse,
  closePairingSession,
  parsePairingOffer,
  respondToPairingOffer,
  parsePairingResponse,
  encodePairingPayload,
  confirmationCode,
  type PairingOffer,
  type PairingResponse,
  type PairingSession,
} from './pairing';

export {
  exportKeyQr,
  openKeyQr,
  generateQrPin,
  expireQrPayload,
  MOBILE_QR_ITERATIONS,
  type MobileKeyQr,
  type MobileKeyQrEnvelope,
} from './mobileKeyQr';

export {
  isPasskeySupported,
  registerPasskey,
  getPasskeyPrf,
  type PasskeyParams,
} from './prf';

export {
  fingerprintFor,
  checkKey,
  pinKey,
  listPins,
  forgetPin,
  clearPins,
  type PinnedKey,
  type PinCheck,
} from './pinning';
