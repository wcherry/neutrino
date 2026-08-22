'use client';

/**
 * E2EE key lifecycle — provisioning, unlocking, rotation and device transfer.
 *
 * The identity lives in one place: this device. There is no server copy, wrapped
 * or otherwise. What the server holds is the *public* half of every version the
 * user has published, which is the directory collaborators consult to seal a DEK
 * to someone.
 *
 *   provisionKeyring()   first run on an account — mint a keyring, wrap it to
 *                        this device, publish the public half, show the kit
 *   unlockKeyring()      later loads — open this device's stored copy
 *   adoptKeyring()       a keyring arriving from elsewhere: a recovery kit, or
 *                        a paired device
 *   rotateIdentity()     mint a new version, publish it, keep the old ones
 *
 * The consequence of having no server copy, which the UI must state plainly:
 * losing every enrolled device *and* the printed recovery kit means the data is
 * gone. Nothing here can undo that, and no support process can either.
 *
 * See `agent_docs/client-only-key-architecture.md`.
 */

import {
  initSodium,
  createKeyring,
  keyringFromKeyPair,
  rotateKeyring,
  activeEntry,
  exportRecoveryKit,
  importRecoveryKit,
  storeUnderPasskey,
  storeUnderPassphrase,
  rewrapExisting,
  unlockWithPasskey as openWithPasskey,
  unlockWithPassphrase as openWithPassphrase,
  getLocalKeystoreInfo,
  hasLocalKeyring,
  clearLocalKeyring,
  setSessionKeyring,
  getSessionKeyring,
  getSessionWrappingKey,
  isUnlocked,
  clearPins,
  toBase64url,
  type Keyring,
  type LocalKeystoreInfo,
  type WrapMethod,
} from '@neutrino/e2e-crypto';
import { authApi } from './client';

/** Where the user stands on this device. */
export type KeyringState =
  /** This device holds no key and the account has published none — first run. */
  | 'none'
  /** The account has a published key, but this device holds no copy of it. */
  | 'needs-device'
  /** This device holds the keyring, locked. */
  | 'locked'
  /** The keyring is in memory and ready to use. */
  | 'unlocked';

export interface KeyringStatus {
  state: KeyringState;
  /** How this device wraps its copy. Null unless `state` is 'locked'. */
  local: LocalKeystoreInfo | null;
}

export interface ProvisionResult {
  /** Shown once. The only copy that survives losing every device. */
  recoveryKit: string;
}

/**
 * Work out what the app should do next for `userId`.
 *
 * The distinction that matters is 'none' versus 'needs-device'. Both mean "this
 * browser cannot decrypt anything", but the first is a new account that should
 * be offered key creation, and the second is an existing account whose files
 * would be orphaned by creating one — that user needs their recovery kit or a
 * paired device, and must not be shown a "set up encryption" button.
 */
export async function getKeyringState(userId: string): Promise<KeyringStatus> {
  await initSodium();
  if (isUnlocked(userId)) return { state: 'unlocked', local: null };

  const local = await getLocalKeystoreInfo(userId);
  if (local) return { state: 'locked', local };

  const published = await authApi.getUserPublicKey(userId).catch(() => null);
  return { state: published ? 'needs-device' : 'none', local: null };
}

// ── Provisioning ──────────────────────────────────────────────────────────────

/**
 * Create a keyring for an account that has none, and wrap it to this device.
 *
 * Returns the recovery kit, which the caller must show before continuing — it
 * is not recoverable afterwards.
 */
export async function provisionKeyring(
  userId: string,
  userName: string,
  wrap: { method: 'passkey'; label: string } | { method: 'passphrase'; passphrase: string },
): Promise<ProvisionResult> {
  await initSodium();
  const keyring = createKeyring(userId);
  await installAndPublish(keyring, userName, wrap);
  return { recoveryKit: exportRecoveryKit(keyring) };
}

/**
 * Adopt a keyring that arrived from somewhere else and wrap it to this device.
 *
 * Used by the recovery-kit and pairing paths. The public half is republished:
 * it is append-only and idempotent server-side, so a keyring whose active
 * version is already published costs nothing, while one restored onto an
 * account whose directory has fallen behind is brought back into step.
 */
export async function adoptKeyring(
  keyring: Keyring,
  userName: string,
  wrap: { method: 'passkey'; label: string } | { method: 'passphrase'; passphrase: string },
): Promise<void> {
  await initSodium();
  await installAndPublish(keyring, userName, wrap);
}

async function installAndPublish(
  keyring: Keyring,
  userName: string,
  wrap: { method: 'passkey'; label: string } | { method: 'passphrase'; passphrase: string },
): Promise<void> {
  if (wrap.method === 'passkey') {
    await storeUnderPasskey(keyring, userName, wrap.label);
  } else {
    await storeUnderPassphrase(keyring, wrap.passphrase);
  }

  // Only after the keyring is safely wrapped on disk — publishing first would
  // advertise a key that a failed write means this device cannot use.
  await publishActive(keyring);

  const unlocked = await reopenAfterWrite(keyring, wrap);
  setSessionKeyring(unlocked.keyring, unlocked.wrappingKey);
}

/**
 * Re-open what we just wrote, to hold the wrapping key for later rotations.
 *
 * A passphrase can be re-derived silently. A passkey cannot — it would mean a
 * second Touch ID prompt immediately after the first — so that path installs the
 * keyring with no wrapping key and lets the next rotation prompt instead.
 */
async function reopenAfterWrite(
  keyring: Keyring,
  wrap: { method: 'passkey'; label: string } | { method: 'passphrase'; passphrase: string },
): Promise<{ keyring: Keyring; wrappingKey?: Uint8Array }> {
  if (wrap.method === 'passphrase') {
    return openWithPassphrase(keyring.userId, wrap.passphrase);
  }
  return { keyring };
}

/** Publish the keyring's active public half to the server's directory. */
async function publishActive(keyring: Keyring): Promise<void> {
  const active = activeEntry(keyring);
  await authApi.setPublicKey({ publicKey: toBase64url(active.publicKey) });
}

// ── Unlocking ─────────────────────────────────────────────────────────────────

export async function unlockKeyring(
  userId: string,
  secret: { method: 'passkey' } | { method: 'passphrase'; passphrase: string },
): Promise<void> {
  await initSodium();
  const opened =
    secret.method === 'passkey'
      ? await openWithPasskey(userId)
      : await openWithPassphrase(userId, secret.passphrase);
  setSessionKeyring(opened.keyring, opened.wrappingKey);
}

/** Restore from the printed kit. `wrap` decides how this device stores it. */
export async function restoreFromRecoveryKit(
  userId: string,
  userName: string,
  kitText: string,
  wrap: { method: 'passkey'; label: string } | { method: 'passphrase'; passphrase: string },
): Promise<void> {
  await initSodium();
  const keyring = importRecoveryKit(kitText, userId);
  await adoptKeyring(keyring, userName, wrap);
}

// ── Rotation ──────────────────────────────────────────────────────────────────

export interface RotationResult {
  newVersion: number;
  /** Must be shown: the previous kit cannot contain the key just minted. */
  recoveryKit: string;
}

/**
 * Mint a new identity version and publish it.
 *
 * Existing files are untouched and stay readable: their DEKs are still sealed to
 * the versions that made them, and those versions remain in the keyring. New
 * work seals to the version this creates.
 *
 * The caller **must** present the returned kit. Because versions are
 * independently random, a kit printed before this rotation cannot restore the
 * key it created — a user who skips this has silently made their backup partial.
 */
export async function rotateIdentity(userId: string): Promise<RotationResult> {
  await initSodium();
  const current = getSessionKeyring(userId);
  if (!current) {
    throw new Error('Unlock your encryption key before rotating it');
  }

  const wrappingKey = getSessionWrappingKey(userId);
  if (!wrappingKey) {
    throw new Error(
      'Unlock this device’s key again before rotating — the new key has to be saved here.',
    );
  }

  const rotated = rotateKeyring(current);

  // Disk first. Publishing a key this device could not save would leave
  // collaborators sealing DEKs to something nobody can open.
  await rewrapExisting(rotated, wrappingKey);
  await publishActive(rotated);
  setSessionKeyring(rotated, wrappingKey);

  return {
    newVersion: activeEntry(rotated).version,
    recoveryKit: exportRecoveryKit(rotated),
  };
}

/** Re-render the kit for an already-unlocked keyring, without rotating. */
export function currentRecoveryKit(userId: string): string {
  const keyring = getSessionKeyring(userId);
  if (!keyring) throw new Error('Unlock your encryption key first');
  return exportRecoveryKit(keyring);
}

// ── Importing a raw keypair (legacy key files) ────────────────────────────────

/**
 * Adopt a bare keypair as a version-1 keyring.
 *
 * For key files exported by a build that predates versioning. Minting a fresh
 * identity instead would orphan everything already sealed to the imported one.
 */
export async function adoptKeyPair(
  userId: string,
  userName: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
  wrap: { method: 'passkey'; label: string } | { method: 'passphrase'; passphrase: string },
): Promise<void> {
  await initSodium();
  await adoptKeyring(keyringFromKeyPair(userId, publicKey, secretKey), userName, wrap);
}

// ── Device management ─────────────────────────────────────────────────────────

export async function deviceHoldsKeyring(userId: string): Promise<boolean> {
  return hasLocalKeyring(userId);
}

/**
 * Forget this device's copy of the keyring.
 *
 * Only the local copy goes; the account's published keys and every file stay as
 * they are. Pinned recipient keys go with it, since they are trust decisions
 * made by an identity this device no longer holds.
 */
export async function forgetThisDevice(userId: string): Promise<void> {
  await clearLocalKeyring(userId);
  clearPins(userId);
}

export type { WrapMethod, LocalKeystoreInfo };
