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
  fromBase64url,
  fromBase64,
  type StoredKeyPair,
} from './keystore';
