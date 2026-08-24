'use client';

/**
 * The keyring at rest, on this device only.
 *
 * The pre-keyring build kept nothing on disk: the identity was fetched from the
 * server's vault on every load and held in memory. That is no longer available —
 * there is no server copy — so the keyring has to persist locally or a page
 * reload would destroy the only copy on this device.
 *
 * What reaches disk is ciphertext, wrapped under a key this origin's JavaScript
 * cannot read out:
 *
 *   passkey PRF (preferred)  the authenticator holds the secret; we only ever
 *                            see the 32 bytes it derives for our salt, and only
 *                            after a user gesture (Touch ID, PIN, tap)
 *   passphrase (fallback)    Argon2id over something the user types, for
 *                            browsers or authenticators without PRF
 *
 * IndexedDB rather than localStorage: it holds structured data without a JSON
 * round-trip, and — the reason that matters — localStorage is synchronous and
 * capped, while a keyring grows by 35 bytes per rotation forever.
 *
 * The wrapping parameters live *beside* the ciphertext in the same record, which
 * is safe here in a way it was not for the server-side vault: nothing remote can
 * substitute weakened parameters, because nothing remote can write to this
 * origin's IndexedDB. The Argon2 floor below is defence against our own past
 * defaults, not against an attacker.
 */

import sodium from 'libsodium-wrappers';
import {
  deserializeKeyring,
  serializeKeyring,
  type Keyring,
  type SerializedKeyring,
} from './keyring';
import { getPasskeyPrf, registerPasskey, type PasskeyParams } from './prf';

const DB_NAME = 'neutrino-keystore';
const DB_VERSION = 1;
const STORE = 'keyrings';

/** Argon2id cost for the passphrase fallback. */
export const ARGON2_DEFAULTS = {
  iterations: 3,
  memoryKiB: 65536,
  parallelism: 1,
} as const;

/**
 * Refuse to derive under costs weaker than these even if a stored record asks
 * for them. Guards against a record written by an older, weaker default rather
 * than against tampering — see the module comment.
 */
const ARGON2_FLOOR = { iterations: 2, memoryKiB: 19456 } as const;

const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

export type WrapMethod = 'passkey' | 'passphrase' | 'device';

/**
 * The unprotected wrap.
 *
 * The wrapping key is stored in the record beside the ciphertext it opens, so
 * the record opens itself and nothing is ever asked of the user. This is not
 * protection and is not pretending to be: it exists because the passphrase
 * prompt was removed by request, and it restores what the build before the key
 * vault did — the identity readable by any script on this origin and by anyone
 * with the browser profile.
 *
 * Kept as an explicit method rather than by storing the keyring in the clear so
 * that `method` still says how a record is protected, and a future build can
 * find these records to re-wrap them.
 */
interface DeviceParams {
  kdf: 'none';
  /** base64url, 32 bytes. The key to the blob it sits next to. */
  key: string;
}

interface PassphraseParams {
  kdf: 'argon2id';
  /** base64url, 16 bytes. */
  salt: string;
  iterations: number;
  memoryKiB: number;
  parallelism: number;
}

/** One device's stored keyring. Keyed by user id. */
interface KeystoreRecord {
  userId: string;
  method: WrapMethod;
  /** `PasskeyParams`, `PassphraseParams` or `DeviceParams`, by `method`. */
  params: PasskeyParams | PassphraseParams | DeviceParams;
  /** base64url( nonce || secretbox ciphertext of the serialised keyring ). */
  blob: string;
  updatedAt: string;
}

/** What the unlock UI needs to know before asking for anything. */
export interface LocalKeystoreInfo {
  method: WrapMethod;
  updatedAt: string;
}

// ── IndexedDB plumbing ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so the key cannot be stored'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the key store'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Key store operation failed'));
      }),
  );
}

async function readRecord(userId: string): Promise<KeystoreRecord | null> {
  const record = await tx<KeystoreRecord | undefined>('readonly', (s) => s.get(userId));
  return record ?? null;
}

// ── Wrapping ──────────────────────────────────────────────────────────────────

/**
 * Encode/decode UTF-8 without libsodium's `from_string`/`to_string`.
 *
 * Those return a `Uint8Array` from libsodium's own realm, which its argument
 * checks then reject via `instanceof` — so `crypto_box_seal(sodium.from_string(x))`
 * throws "unsupported input type for message" under some bundlers and test
 * environments. `TextEncoder` output, copied into a local `Uint8Array`, is
 * always accepted.
 */
function utf8(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text));
}

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function unb64u(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function seal(plaintext: Uint8Array, key: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return b64u(out);
}

function open(blob: string, key: Uint8Array): Uint8Array {
  const raw = unb64u(blob);
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  if (raw.length <= nonceLen) {
    throw new Error('Stored key is malformed');
  }
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = sodium.crypto_secretbox_open_easy(raw.slice(nonceLen), raw.slice(0, nonceLen), key);
  } catch {
    plaintext = null;
  }
  if (!plaintext) {
    // libsodium throws "wrong secret key for the given ciphertext", which would
    // reach the user through the unlock dialog. A mistyped passphrase should
    // read as one.
    throw new Error('Could not unlock — wrong passphrase, or the stored key is damaged');
  }
  return plaintext;
}

function newPassphraseParams(): PassphraseParams {
  return {
    kdf: 'argon2id',
    salt: b64u(sodium.randombytes_buf(SALT_BYTES)),
    ...ARGON2_DEFAULTS,
  };
}

/**
 * Argon2id, not PBKDF2: the threat is someone with the device's disk grinding
 * candidate passphrases offline, and Argon2id's memory cost is what makes that
 * expensive on a GPU.
 *
 * `hash-wasm` is imported dynamically so its ~29 KB stays off the initial bundle
 * — it is only needed when someone actually unlocks with a passphrase.
 */
async function derivePassphraseKey(
  passphrase: string,
  params: PassphraseParams,
): Promise<Uint8Array> {
  if (params.kdf !== 'argon2id') {
    throw new Error(`Unsupported key derivation: ${String(params.kdf)}`);
  }
  const { argon2id } = await import('hash-wasm');

  const hex = await argon2id({
    password: passphrase,
    salt: unb64u(params.salt),
    iterations: Math.max(params.iterations, ARGON2_FLOOR.iterations),
    memorySize: Math.max(params.memoryKiB, ARGON2_FLOOR.memoryKiB),
    parallelism: params.parallelism,
    hashLength: DERIVED_KEY_BYTES,
    outputType: 'hex',
  });

  const key = new Uint8Array(DERIVED_KEY_BYTES);
  for (let i = 0; i < DERIVED_KEY_BYTES; i += 1) {
    key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return key;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** How this device wraps `userId`'s keyring, or null if it holds none. */
export async function getLocalKeystoreInfo(userId: string): Promise<LocalKeystoreInfo | null> {
  const record = await readRecord(userId);
  if (!record) return null;
  return { method: record.method, updatedAt: record.updatedAt };
}

export async function hasLocalKeyring(userId: string): Promise<boolean> {
  return (await readRecord(userId)) !== null;
}

/**
 * Store `keyring` wrapped under a newly registered passkey.
 *
 * The PRF secret stays in the authenticator; we hold its 32-byte output only for
 * the moment it takes to wrap.
 */
export async function storeUnderPasskey(
  keyring: Keyring,
  userName: string,
  label: string,
): Promise<void> {
  const { params, prfOutput } = await registerPasskey(keyring.userId, userName, label);
  try {
    await writeRecord(keyring, 'passkey', params, prfOutput);
  } finally {
    prfOutput.fill(0);
  }
}

/**
 * Store `keyring` so that this device can open it with nothing asked of anyone.
 *
 * See `DeviceParams`: the key travels in the record. Used for every new keyring
 * now that the passphrase prompt is gone, and to convert a record the user has
 * just unlocked so they are not asked a second time.
 */
export async function storeOnDevice(keyring: Keyring): Promise<void> {
  const key = sodium.randombytes_buf(DERIVED_KEY_BYTES);
  try {
    await writeRecord(keyring, 'device', { kdf: 'none', key: b64u(key) }, key);
  } finally {
    key.fill(0);
  }
}

/** Store `keyring` wrapped under a passphrase, for devices without PRF. */
export async function storeUnderPassphrase(keyring: Keyring, passphrase: string): Promise<void> {
  const params = newPassphraseParams();
  const key = await derivePassphraseKey(passphrase, params);
  try {
    await writeRecord(keyring, 'passphrase', params, key);
  } finally {
    key.fill(0);
  }
}

async function writeRecord(
  keyring: Keyring,
  method: WrapMethod,
  params: PasskeyParams | PassphraseParams | DeviceParams,
  wrappingKey: Uint8Array,
): Promise<void> {
  const plaintext = utf8(JSON.stringify(serializeKeyring(keyring)));
  const record: KeystoreRecord = {
    userId: keyring.userId,
    method,
    params,
    blob: seal(plaintext, wrappingKey),
    updatedAt: new Date().toISOString(),
  };
  plaintext.fill(0);
  await tx('readwrite', (s) => s.put(record));
}

/**
 * Re-wrap an already-unlocked keyring under the method it is already using.
 *
 * This is what a rotation calls: the new entry has to reach disk, and demanding
 * a second Touch ID prompt or a retyped passphrase to save a key the user just
 * asked us to create would be theatre. Requires the caller to hold the wrapping
 * key from the unlock that is still in effect.
 */
export async function rewrapExisting(keyring: Keyring, wrappingKey: Uint8Array): Promise<void> {
  const record = await readRecord(keyring.userId);
  if (!record) {
    throw new Error('This device holds no stored key to update');
  }
  await writeRecord(keyring, record.method, record.params, wrappingKey);
}

/**
 * Unlock with the enrolled passkey.
 *
 * Returns the wrapping key alongside the keyring so a later rotation can re-wrap
 * without prompting again; callers that do not need it should let it fall out of
 * scope.
 */
export async function unlockWithPasskey(
  userId: string,
): Promise<{ keyring: Keyring; wrappingKey: Uint8Array }> {
  const record = await readRecord(userId);
  if (!record) throw new Error('This device holds no stored key');
  if (record.method !== 'passkey') {
    throw new Error('This device’s key is protected by a passphrase, not a passkey');
  }
  const wrappingKey = await getPasskeyPrf(record.params as PasskeyParams);
  return { keyring: openRecord(record, wrappingKey, userId), wrappingKey };
}

/**
 * Open a device-wrapped record. Asks the user nothing, because it can't — the
 * key is in the record.
 */
export async function unlockOnDevice(
  userId: string,
): Promise<{ keyring: Keyring; wrappingKey: Uint8Array }> {
  const record = await readRecord(userId);
  if (!record) throw new Error('This device holds no stored key');
  if (record.method !== 'device') {
    throw new Error('This device’s key is protected and has to be unlocked');
  }
  const wrappingKey = unb64u((record.params as DeviceParams).key);
  return { keyring: openRecord(record, wrappingKey, userId), wrappingKey };
}

/** Unlock with the passphrase this device's keyring was wrapped under. */
export async function unlockWithPassphrase(
  userId: string,
  passphrase: string,
): Promise<{ keyring: Keyring; wrappingKey: Uint8Array }> {
  const record = await readRecord(userId);
  if (!record) throw new Error('This device holds no stored key');
  if (record.method !== 'passphrase') {
    throw new Error('This device’s key is protected by a passkey, not a passphrase');
  }
  const wrappingKey = await derivePassphraseKey(passphrase, record.params as PassphraseParams);
  return { keyring: openRecord(record, wrappingKey, userId), wrappingKey };
}

function openRecord(record: KeystoreRecord, wrappingKey: Uint8Array, userId: string): Keyring {
  const plaintext = open(record.blob, wrappingKey);
  const parsed = JSON.parse(fromUtf8(plaintext)) as SerializedKeyring;
  plaintext.fill(0);

  const keyring = deserializeKeyring(parsed);
  // A record filed under one user must not open into another's session; the
  // store is keyed by user id, so a mismatch means the record was tampered with
  // or written by a bug, and either way it is not safe to install.
  if (keyring.userId !== userId) {
    throw new Error('Stored key belongs to a different account');
  }
  return keyring;
}

/** Forget this device's copy. The keyring survives only where else it is held. */
export async function clearLocalKeyring(userId: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(userId));
}
