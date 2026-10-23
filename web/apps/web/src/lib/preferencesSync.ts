/**
 * Connecting the preference store (`@neutrino/preferences`) to this app: its HTTP backend, the
 * vault's cryptography, and the session it belongs to.
 *
 * The store itself has no dependencies, so the app supplies both halves when a user is signed
 * in — `/api/v1/preferences` for the plain tier, and sealing to the user's own keyring for the
 * vault (`sealPreferenceVault`, the saved-place construction). The vault is opened with the
 * keypair for the version it was sealed to, so a vault written before a key rotation still opens.
 */

import { useEffect } from 'react';
import { request, ApiClientError, readLegacyAiSettings, setAiSettingsStore } from '@neutrino/api-core';
import {
  activeKeyVersion,
  initSodium,
  loadKeyPair,
  loadKeyPairForVersion,
  openPreferenceVault,
  preferenceVaultKeyVersion,
  sealPreferenceVault,
  subscribeToLockState,
} from '@neutrino/e2e-crypto';
import {
  migrateLegacyPreferences,
  preferences,
  VaultConflictError,
  type PreferenceBackend,
  type PreferencesSnapshot,
  type VaultCrypto,
} from '@neutrino/preferences';
import { PREFERENCES_CHANGED_EVENT } from './preferencesSignal';

/**
 * AI credentials come from the store: the provider is a synced preference and the key is sealed
 * in the vault. Until the vault is open (signed out, locked, or the first load of a session) the
 * legacy plaintext record is still the only copy, so it answers for the key — otherwise every AI
 * feature would fail in the moments between page load and unlock.
 */
setAiSettingsStore({
  read: () => ({
    provider: preferences.get('ai.provider'),
    apiKey: preferences.vaultAvailable ? preferences.get('ai.apiKey') : readLegacyAiSettings().apiKey,
  }),
  write: (settings) => {
    preferences.set('ai.provider', settings.provider);
    preferences.set('ai.apiKey', settings.apiKey);
  },
});


export const preferencesBackend: PreferenceBackend = {
  load: () => request<PreferencesSnapshot>('/api/v1/preferences'),
  patch: (values) =>
    request<PreferencesSnapshot>('/api/v1/preferences', { method: 'PATCH', body: JSON.stringify({ values }) }),
  putVault: async (blob, baseUpdatedAt) => {
    try {
      return await request<{ updatedAt: string }>('/api/v1/preferences/vault', {
        method: 'PUT',
        body: JSON.stringify({ blob, baseUpdatedAt }),
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 409) throw new VaultConflictError();
      throw e;
    }
  },
};

export function vaultCryptoFor(userId: string): VaultCrypto {
  return {
    ready: () => loadKeyPair(userId) !== null && activeKeyVersion(userId) !== null,
    seal: (payload) => {
      const keyPair = loadKeyPair(userId);
      const version = activeKeyVersion(userId);
      if (!keyPair || version === null) throw new Error('No keypair to seal the preference vault with');
      return sealPreferenceVault(payload, keyPair.publicKey, version);
    },
    open: (blob) => {
      const keyPair = loadKeyPairForVersion(userId, preferenceVaultKeyVersion(blob));
      if (!keyPair) throw new Error('This device does not hold the key the preference vault was sealed to');
      return openPreferenceVault(blob, keyPair.publicKey, keyPair.secretKey);
    },
  };
}

function migrate(): void {
  migrateLegacyPreferences(preferences, window.localStorage).catch((e) => {
    console.warn('[prefs:migrate] failed', e);
  });
}

/**
 * Keep the store attached to the signed-in user: load and migrate on sign-in, open the vault
 * when the session unlocks, and re-read when another device signals a change. Mounted once, in
 * the app shell; sign-out detaches (`handleSignOut`).
 */
export function usePreferencesSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const crypto = vaultCryptoFor(userId);

    initSodium()
      .then(() => preferences.attach(userId, preferencesBackend, crypto))
      .then(() => { if (!cancelled) migrate(); })
      .catch((e) => console.warn('[prefs] loading preferences failed', e));

    const unsubscribeLock = subscribeToLockState(() => {
      if (!crypto.ready()) return;
      void preferences.onUnlocked().then(() => { if (!cancelled) migrate(); });
    });
    const onRemoteChange = () => { void preferences.refresh().catch(() => {}); };
    window.addEventListener(PREFERENCES_CHANGED_EVENT, onRemoteChange);
    const onUnload = () => { void preferences.flush(); };
    window.addEventListener('pagehide', onUnload);

    return () => {
      cancelled = true;
      unsubscribeLock();
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, onRemoteChange);
      window.removeEventListener('pagehide', onUnload);
    };
  }, [userId]);
}
