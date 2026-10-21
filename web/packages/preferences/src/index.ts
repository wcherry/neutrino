export {
  REGISTRY,
  specFor,
  defaultOf,
  isValid,
  type PreferenceKey,
  type PreferenceSpec,
  type PreferenceType,
  type PreferenceValues,
  type Sync,
} from './registry';
export {
  PreferenceStore,
  preferences,
  VaultConflictError,
  BOOT_KEY,
  type PreferenceBackend,
  type PreferencesSnapshot,
  type StorageLike,
  type VaultCrypto,
} from './store';
export { usePreference, useLibrary, useVaultAvailable } from './react';
export { migrateLegacyPreferences, readVaultOrLegacy } from './migrate';
