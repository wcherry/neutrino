'use client';

/**
 * E2EE key lifecycle — provisioning, unlocking, and managing unlock methods.
 *
 * The identity key lives in one place on disk: the server, wrapped, as a blob
 * nothing on the server can open. Locally it exists only in memory, for as long
 * as the session is unlocked.
 *
 *   provisionVault()  first ever login — mint an identity, wrap it, enrol
 *                     a password and a recovery code
 *   unlockWith*()     later logins and reloads — recover the master key, open
 *                     the identity, install it in the session
 *   enrollPasskey()   add a method; requires an already-unlocked session
 *
 * Nothing here ever sends a password, a recovery code, or a PRF output to the
 * server — only the ciphertext they produce.
 */

import {
  initSodium,
  generateKeyPair,
  generateMasterKey,
  wrapIdentity,
  openVault,
  buildSecretUnlock,
  buildPasskeyUnlock,
  unwrapWithSecret,
  unwrapWithPasskey,
  saveKeyPair,
  setSessionMasterKey,
  getSessionMasterKey,
  isUnlocked,
  generateRecoveryCode,
  normalizeRecoveryCode,
  readLegacyKeyPair,
  clearLegacyKeyPair,
  toBase64url,
  toBase64urlBytes,
  type UnlockMethodBlob,
  type VaultBundle,
} from '@neutrino/e2e-crypto';
import { authApi } from './client';
import type { UnlockMethodResponse, VaultResponse } from './types';

/** Where the user stands with respect to their vault. */
export type VaultState =
  /** No vault yet — first login, or a fresh account. */
  | 'none'
  /** Vault exists, session is locked. */
  | 'locked'
  /** Key is in memory and ready to use. */
  | 'unlocked';

export interface ProvisionResult {
  /** Shown once, then never recoverable. */
  recoveryCode: string;
}

function toBundle(v: VaultResponse): VaultBundle {
  return {
    encryptedIdentity: v.encryptedIdentity,
    publicKey: v.publicKey,
    version: v.version,
    unlocks: v.unlocks.map((u) => ({
      id: u.id,
      method: u.method,
      label: u.label,
      encryptedMasterKey: u.encryptedMasterKey,
      params: u.params,
      createdAt: u.createdAt,
      lastUsedAt: u.lastUsedAt,
    })),
  };
}

/**
 * Determine what the app should do next for `userId`.
 *
 * Returns the vault alongside the state so the unlock UI can show which methods
 * are enrolled without a second round-trip.
 */
export async function getVaultState(
  userId: string,
): Promise<{ state: VaultState; vault: VaultBundle | null }> {
  await initSodium();
  if (isUnlocked(userId)) return { state: 'unlocked', vault: null };

  const vault = await authApi.getVault();
  if (!vault) return { state: 'none', vault: null };
  return { state: 'locked', vault: toBundle(vault) };
}

/**
 * Create a vault for a user who has none.
 *
 * If the pre-vault build left a plaintext key in localStorage it is adopted
 * rather than replaced — the user's existing files are sealed to it, and
 * minting a fresh identity here would orphan every one of them. The plaintext
 * copy is deleted only after the wrapped vault is confirmed stored.
 */
export async function provisionVault(
  userId: string,
  userName: string,
  password: string,
): Promise<ProvisionResult> {
  await initSodium();

  const legacy = readLegacyKeyPair(userId);
  const { publicKey, secretKey } = legacy ?? generateKeyPair();

  const masterKey = generateMasterKey();
  const recoveryCode = generateRecoveryCode();

  const [passwordUnlock, recoveryUnlock] = await Promise.all([
    buildSecretUnlock(masterKey, password, 'password', 'Password'),
    buildSecretUnlock(masterKey, normalizeRecoveryCode(recoveryCode), 'recovery', 'Recovery code'),
  ]);

  await authApi.putVault({
    encryptedIdentity: wrapIdentity(secretKey, masterKey),
    publicKey: toBase64urlBytes(publicKey),
    unlocks: [passwordUnlock, recoveryUnlock].map(toUnlockInput),
  });

  saveKeyPair(userId, publicKey, secretKey);
  setSessionMasterKey(userId, masterKey);

  if (legacy) clearLegacyKeyPair(userId);

  return { recoveryCode };
}

function toUnlockInput(u: UnlockMethodBlob) {
  return {
    method: u.method,
    label: u.label,
    encryptedMasterKey: u.encryptedMasterKey,
    params: u.params,
  };
}

// ── Unlocking ─────────────────────────────────────────────────────────────────

function installUnlocked(userId: string, vault: VaultBundle, masterKey: Uint8Array): void {
  const { publicKey, secretKey } = openVault(vault, masterKey);
  saveKeyPair(userId, publicKey, secretKey);
  setSessionMasterKey(userId, masterKey);
}

function findMethod(vault: VaultBundle, method: string): UnlockMethodBlob | undefined {
  return vault.unlocks.find((u) => u.method === method);
}

/** Unlock with the account's vault password. Throws if it is wrong. */
export async function unlockWithPassword(
  userId: string,
  vault: VaultBundle,
  password: string,
): Promise<void> {
  await initSodium();
  const unlock = findMethod(vault, 'password');
  if (!unlock) throw new Error('No password is enrolled for this account');

  const masterKey = await unwrapWithSecret(unlock, password);
  installUnlocked(userId, vault, masterKey);
  if (unlock.id) void authApi.markUnlockMethodUsed(unlock.id);
}

/**
 * Unlock with an enrolled passkey.
 *
 * Tries each enrolled passkey in turn: the vault may list one per device, and
 * only the authenticator physically present can answer.
 */
export async function unlockWithPasskey(userId: string, vault: VaultBundle): Promise<void> {
  await initSodium();
  const passkeys = vault.unlocks.filter((u) => u.method === 'passkey');
  if (passkeys.length === 0) throw new Error('No passkey is enrolled for this account');

  let lastError: unknown = null;
  for (const unlock of passkeys) {
    try {
      const masterKey = await unwrapWithPasskey(unlock);
      installUnlocked(userId, vault, masterKey);
      if (unlock.id) void authApi.markUnlockMethodUsed(unlock.id);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Passkey unlock failed');
}

/** Unlock with the recovery code shown at provisioning. */
export async function unlockWithRecoveryCode(
  userId: string,
  vault: VaultBundle,
  code: string,
): Promise<void> {
  await initSodium();
  const unlock = findMethod(vault, 'recovery');
  if (!unlock) throw new Error('No recovery code is enrolled for this account');

  const masterKey = await unwrapWithSecret(unlock, normalizeRecoveryCode(code));
  installUnlocked(userId, vault, masterKey);
  if (unlock.id) void authApi.markUnlockMethodUsed(unlock.id);
}

// ── Managing unlock methods (session must already be unlocked) ────────────────

function requireMasterKey(userId: string): Uint8Array {
  const masterKey = getSessionMasterKey(userId);
  if (!masterKey) {
    throw new Error('Unlock your encryption key before changing how it is protected');
  }
  return masterKey;
}

/** Enrol a passkey against the current vault. */
export async function enrollPasskey(
  userId: string,
  userName: string,
  label: string,
): Promise<UnlockMethodResponse> {
  await initSodium();
  const masterKey = requireMasterKey(userId);
  const unlock = await buildPasskeyUnlock(masterKey, userId, userName, label);
  return authApi.addUnlockMethod(toUnlockInput(unlock));
}

/** Replace the vault password. Does not touch the login password. */
export async function changeVaultPassword(
  userId: string,
  newPassword: string,
): Promise<UnlockMethodResponse> {
  await initSodium();
  const masterKey = requireMasterKey(userId);
  const unlock = await buildSecretUnlock(masterKey, newPassword, 'password', 'Password');
  return authApi.addUnlockMethod(toUnlockInput(unlock));
}

/** Issue a fresh recovery code, invalidating the previous one. */
export async function regenerateRecoveryCode(userId: string): Promise<string> {
  await initSodium();
  const masterKey = requireMasterKey(userId);
  const recoveryCode = generateRecoveryCode();
  const unlock = await buildSecretUnlock(
    masterKey,
    normalizeRecoveryCode(recoveryCode),
    'recovery',
    'Recovery code',
  );
  await authApi.addUnlockMethod(toUnlockInput(unlock));
  return recoveryCode;
}

/** Revoke an unlock method, e.g. a passkey on a lost device. */
export async function revokeUnlockMethod(id: string): Promise<void> {
  await authApi.removeUnlockMethod(id);
}

/**
 * Swap in a different identity key — importing one from another device, or
 * minting a fresh one.
 *
 * Reuses the session's master key, which lets the existing unlock methods carry
 * over verbatim: their wrapped copies of MK are still correct, since only the
 * thing MK protects has changed. Without that they would all have to be
 * re-enrolled, and every passkey re-registered.
 *
 * Note this does not re-key existing files. Anything sealed to the previous
 * public key stops being readable, which is why the callers confirm first.
 */
export async function replaceIdentity(
  userId: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Promise<void> {
  await initSodium();
  const masterKey = requireMasterKey(userId);

  const existing = await authApi.getVault();
  const unlocks = (existing?.unlocks ?? []).map((u) => ({
    method: u.method,
    label: u.label,
    encryptedMasterKey: u.encryptedMasterKey,
    params: u.params,
  }));
  if (unlocks.length === 0) {
    throw new Error('No unlock methods are enrolled — set up encryption first');
  }

  await authApi.putVault({
    encryptedIdentity: wrapIdentity(secretKey, masterKey),
    publicKey: toBase64urlBytes(publicKey),
    unlocks,
  });

  saveKeyPair(userId, publicKey, secretKey);
  setSessionMasterKey(userId, masterKey);
}

export async function listUnlockMethods(): Promise<UnlockMethodResponse[]> {
  const vault = await authApi.getVault();
  return vault?.unlocks ?? [];
}

/**
 * Publish the caller's public key if the server has not got it.
 *
 * `putVault` already writes it, so this only covers accounts provisioned before
 * the vault existed.
 */
export async function ensurePublicKeyRegistered(userId: string): Promise<void> {
  const existing = await authApi.getUserPublicKey(userId);
  if (existing) return;
  const { getSessionKeyPair } = await import('@neutrino/e2e-crypto');
  const kp = getSessionKeyPair(userId);
  if (kp) {
    await authApi.setPublicKey({ publicKey: toBase64url(kp.publicKey) });
  }
}
