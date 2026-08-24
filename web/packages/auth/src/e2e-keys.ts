'use client';

/**
 * E2EE key lifecycle — provisioning, unlocking, rotation and device transfer.
 *
 * The *active* identity lives in one place: this device. There is no server
 * copy of it, wrapped or otherwise. What the server holds is the *public* half
 * of every version the user has published — the directory collaborators consult
 * to seal a DEK to someone — and, since rotation started writing one, the key
 * file: the account's **retired** secret keys, sealed to the active public key
 * so that only the holder of the current identity can open them. The server
 * cannot read that either; see `keyFile.ts` for why it is sealed to the active
 * key and not to this device's wrapping key.
 *
 *   provisionKeyring()   first run on an account — mint a keyring, wrap it to
 *                        this device, publish the public half, show the kit
 *   unlockKeyring()      later loads — open this device's stored copy
 *   adoptKeyring()       a keyring arriving from elsewhere: a recovery kit, or
 *                        a paired device
 *   rotateIdentity()     mint a new version, publish it, keep the old ones —
 *                        and archive them to the key file
 *
 * The consequence of having no server copy of the active key, which the UI must
 * state plainly: losing every enrolled device *and* the printed recovery kit
 * means the data is gone. The key file does not soften this — it protects the
 * versions you have rotated *away* from, and it is itself sealed to the active
 * key, so it is worth nothing without one. Nothing here can undo that, and no
 * support process can either.
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
  storeOnDevice,
  rewrapExisting,
  unlockWithPasskey as openWithPasskey,
  unlockWithPassphrase as openWithPassphrase,
  unlockOnDevice as openOnDevice,
  getLocalKeystoreInfo,
  hasLocalKeyring,
  clearLocalKeyring,
  setSessionKeyring,
  getSessionKeyring,
  getSessionWrappingKey,
  isUnlocked,
  clearPins,
  toBase64url,
  buildKeyFile,
  type Keyring,
  type LocalKeystoreInfo,
  type WrapMethod,
} from '@neutrino/e2e-crypto';
import { keyFileApi } from '@neutrino/api-drive';
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

/**
 * How a keyring is wrapped on this device.
 *
 * `device` is the default everywhere now that the passphrase prompt has been
 * removed — it stores the key beside the ciphertext so nothing has to be asked.
 * The other two remain because devices enrolled before this still use them, and
 * because nothing about them is broken should they be wanted back.
 */
export type WrapChoice =
  | { method: 'device' }
  | { method: 'passkey'; label: string }
  | { method: 'passphrase'; passphrase: string };

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
  // A device-wrapped record opens itself, so asking the user to unlock it would
  // be a prompt with nothing to ask for. This is what keeps the unlock dialog
  // off the screen: by the time anything renders, the session is already open.
  if (local?.method === 'device') {
    try {
      const opened = await openOnDevice(userId);
      setSessionKeyring(opened.keyring, opened.wrappingKey);
      return { state: 'unlocked', local: null };
    } catch {
      // A record that will not open is worse than none: fall through and let the
      // user restore, rather than reporting an unlocked session that is not.
      return { state: 'needs-device', local: null };
    }
  }
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
  wrap: WrapChoice = { method: 'device' },
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
  wrap: WrapChoice = { method: 'device' },
): Promise<void> {
  await initSodium();
  await installAndPublish(keyring, userName, wrap);
}

async function installAndPublish(
  keyring: Keyring,
  userName: string,
  wrap: WrapChoice,
): Promise<void> {
  if (wrap.method === 'passkey') {
    await storeUnderPasskey(keyring, userName, wrap.label);
  } else if (wrap.method === 'passphrase') {
    await storeUnderPassphrase(keyring, wrap.passphrase);
  } else {
    await storeOnDevice(keyring);
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
  wrap: WrapChoice,
): Promise<{ keyring: Keyring; wrappingKey?: Uint8Array }> {
  if (wrap.method === 'passphrase') {
    return openWithPassphrase(keyring.userId, wrap.passphrase);
  }
  if (wrap.method === 'device') {
    return openOnDevice(keyring.userId);
  }
  return { keyring };
}

/** Publish the keyring's active public half to the server's directory. */
async function publishActive(keyring: Keyring): Promise<void> {
  const active = activeEntry(keyring);
  await authApi.setPublicKey({ publicKey: toBase64url(active.publicKey) });
}

// ── Unlocking ─────────────────────────────────────────────────────────────────

/**
 * Open this device's stored copy.
 *
 * Only reachable now for a device enrolled before the passphrase prompt was
 * removed. Such a record is converted to device wrapping on the way out, so the
 * prompt the user just answered is the last one they see on this browser —
 * leaving it alone would mean the dialog came back on every load, which is the
 * thing being removed.
 *
 * The conversion is deliberately not fatal: the session is already open by the
 * time it runs, so failing the unlock over it would turn a working sign-in into
 * a broken one to fix a papercut.
 */
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

  try {
    await storeOnDevice(opened.keyring);
  } catch {
    // Still wrapped the old way; the user will be asked again next load.
  }
}

/** Restore from the printed kit. `wrap` decides how this device stores it. */
export async function restoreFromRecoveryKit(
  userId: string,
  userName: string,
  kitText: string,
  wrap: WrapChoice = { method: 'device' },
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
  /**
   * Whether the retired keys reached the server's key file.
   *
   * False means the rotation succeeded but its archive did not, leaving every
   * version before `newVersion` on this device alone. The caller must say so
   * rather than let a partial result read as a whole one — that silence is what
   * would turn a warning into data loss on the next cleared profile.
   */
  keyFileStored: boolean;
  /** Why the archive failed, when it did. Shown so the failure is diagnosable. */
  keyFileError?: string;
}

/**
 * Archive the keyring's retired keys to the server.
 *
 * Deliberately not fatal to the rotation that calls it. By the time this runs
 * the new key is on disk and published; failing the whole operation over the
 * backup would abandon a rotation that already happened, leaving the session
 * holding a key the caller thinks was never minted. Reporting the failure up so
 * the UI can ask for a retry is the honest half of that trade — swallowing it
 * silently is not.
 */
async function archiveRetiredKeys(keyring: Keyring): Promise<string | null> {
  const keys = buildKeyFile(keyring);
  if (keys.length === 0) {
    // Nothing has been rotated away from yet, and the server rejects an empty
    // key file — correctly, since that is what DELETE means.
    return null;
  }
  try {
    await keyFileApi.putKeyFile({ keys });
    return null;
  } catch (e) {
    // Returned rather than logged and dropped. This used to be a `console.warn`
    // and a bare `false`, which is how an account can end up rotated several
    // times with no key file on the server and nothing on screen having said so
    // — every retired key then exists only in this browser profile, one cleared
    // site-data away from taking its files with it.
    const reason = e instanceof Error ? e.message : String(e);
    console.warn('[e2e-keys] could not store the key file', e);
    return reason;
  }
}

/**
 * Store the account's retired keys, without rotating.
 *
 * The archive is otherwise written only as a side effect of `rotateIdentity`,
 * which makes a failed write unrecoverable by any means short of rotating again
 * — and rotating again mints yet another version to lose, so the one remedy on
 * offer made the problem worse. This is the retry.
 *
 * Safe to run at any time: the server replaces the stored set, and the set is
 * rebuilt from this device's keyring each time.
 *
 * Throws on failure rather than reporting a boolean, because the caller here is
 * a user who pressed a button and is owed the reason.
 */
export async function backUpRetiredKeys(userId: string): Promise<{ versions: number[] }> {
  await initSodium();
  const keyring = getSessionKeyring(userId);
  if (!keyring) throw new Error('Unlock your encryption key first');

  const keys = buildKeyFile(keyring);
  if (keys.length === 0) {
    // Not an error: an account that has never rotated has no retired keys, and
    // the server rejects an empty key file.
    return { versions: [] };
  }
  await keyFileApi.putKeyFile({ keys });
  return { versions: keys.map((k) => k.keyVersion) };
}

/**
 * Which versions the server currently holds for this account.
 *
 * Read back rather than assumed, so the UI can state the difference between
 * "backed up" and "only on this device" as fact. Null means the server has no
 * key file at all.
 */
export async function storedKeyFileVersions(): Promise<number[] | null> {
  const stored = await keyFileApi.getKeyFile();
  return stored ? stored.keys.map((k) => k.keyVersion).sort((a, b) => a - b) : null;
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

  // Last, and only once the rotation is real: the key file seals the retired
  // entries to the version just published, so it cannot be written before that
  // version exists, and it must not be written for a rotation that failed.
  const keyFileError = await archiveRetiredKeys(rotated);

  return {
    newVersion: activeEntry(rotated).version,
    recoveryKit: exportRecoveryKit(rotated),
    keyFileStored: keyFileError === null,
    keyFileError: keyFileError ?? undefined,
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
  wrap: WrapChoice = { method: 'device' },
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
