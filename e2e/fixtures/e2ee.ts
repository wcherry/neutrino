/**
 * The first-run encryption gate, and reading what it wrote.
 *
 * Signing in no longer provisions an E2EE identity on its own. A fresh account
 * lands on `/drive` behind `E2EEUnlockGate`'s "Set up encryption" modal, and the
 * keyring is minted only when someone presses *Create my key* and acknowledges
 * the recovery kit. Until that happens the account has no published public key,
 * so nothing that seals a DEK can run — which is every editor's first save and
 * every upload. The modal is also a real modal: it swallows clicks aimed at the
 * page behind it, so a test that ignores it fails on whatever it tried to click
 * next rather than on the thing that is actually wrong.
 *
 * `setUpEncryption` is therefore part of signing in, and every `registerAndLogin`
 * helper calls it.
 *
 * What it writes is no longer a `neutrino_e2e_<userId>` entry in localStorage —
 * that was the pre-keyring build, which kept a bare keypair there in the clear.
 * The keyring now lives in IndexedDB (`neutrino-keystore` / `keyrings`), wrapped
 * under a key stored in the same record; `readKeystoreRecord`, `waitForKeyring`
 * and `activeKeyPair` are how a test reaches it.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { initSodium, decryptFile, decryptFileKey } from '../../web/packages/e2e-crypto/src/crypto';

/** Resolved from the web workspace — the e2e package has no crypto dependency. */
const webRequire = createRequire(
  path.resolve(__dirname, '../../web/packages/e2e-crypto/package.json'),
);

interface Sodium {
  ready: Promise<void>;
  base64_variants: { URLSAFE_NO_PADDING: number };
  from_base64(input: string, variant: number): Uint8Array;
  crypto_secretbox_NONCEBYTES: number;
  crypto_secretbox_open_easy(ct: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_scalarmult_base(sk: Uint8Array): Uint8Array;
}

const sodium = webRequire('libsodium-wrappers') as Sodium;

/** Mirrors `keystoreLocal.ts` — see the DB_NAME / STORE constants there. */
export const KEYSTORE_DB = 'neutrino-keystore';
export const KEYSTORE_STORE = 'keyrings';

/** One device's stored keyring, as `keystoreLocal.ts` writes it. */
export interface KeystoreRecord {
  userId: string;
  method: 'passkey' | 'passphrase' | 'device';
  /** For `device`, `{ kdf: 'none', key }` — the key to the blob beside it. */
  params: { kdf: string; key?: string };
  /** base64url( nonce || secretbox(serialised keyring) ). */
  blob: string;
  updatedAt: string;
}

export interface E2EEKeyPair {
  /** base64url, 32 bytes. */
  publicKey: string;
  /** base64url, 32 bytes. */
  secretKey: string;
}

const GATE_TIMEOUT = 20_000;

/** How many times to ask for a key before treating the failure as real. */
const PROVISION_ATTEMPTS = 3;

/**
 * Complete the first-run encryption setup, so the session can encrypt.
 *
 * A no-op when this browser context already holds a keyring — a test that signs
 * a second user in through the same context has already been through the gate.
 * Otherwise the modal must appear: a fresh account that reaches `/drive` without
 * it is a bug worth failing on rather than waiting out.
 */
export async function setUpEncryption(page: Page): Promise<void> {
  if (await hasAnyKeyring(page)) return;

  const setup = page.getByRole('dialog', { name: 'Set up encryption' });
  await expect(setup, 'the first-run encryption gate must appear for a fresh account')
    .toBeVisible({ timeout: GATE_TIMEOUT });

  const kit = page.getByRole('dialog', { name: 'Save your recovery kit' });

  // Retried because publishing the public key can come back 500 under the write
  // contention of a full serial run — see the `database is locked` entries in
  // the service log. The dialog is built for exactly this: a failed attempt
  // leaves an error alert and the button in place, and provisioning again mints
  // a fresh keyring. Bounded, so a server that is genuinely broken still fails.
  for (let attempt = 1; attempt <= PROVISION_ATTEMPTS; attempt += 1) {
    await setup.getByRole('button', { name: 'Create my key' }).click();
    try {
      await expect(kit).toBeVisible({ timeout: GATE_TIMEOUT });
      break;
    } catch (err) {
      if (attempt === PROVISION_ATTEMPTS) {
        const reason = (await setup.getByRole('alert').innerText().catch(() => '')) || 'no error shown';
        throw new Error(
          `encryption setup failed after ${PROVISION_ATTEMPTS} attempts: ${reason.trim()}`,
        );
      }
    }
  }

  // The kit is shown exactly once and Done stays disabled until it is
  // acknowledged, so the checkbox is not optional politeness.
  await kit.getByRole('checkbox').check();
  await kit.getByRole('button', { name: 'Done' }).click();
  await expect(kit).toBeHidden({ timeout: GATE_TIMEOUT });
}

/**
 * Acknowledge the key minted by registering through the UI.
 *
 * The register page does not go through `E2EEUnlockGate`: it mounts
 * `EncryptionSetupDialog`, which provisions the keyring on mount and then shows
 * the recovery kit. The redirect to `/drive` is that dialog's `onDone`, so a
 * test that registers through the form and waits for the URL to change waits
 * forever unless it acknowledges the kit first.
 */
export async function finishRegistrationEncryption(page: Page): Promise<void> {
  const ready = page.getByRole('dialog', { name: 'Your encryption key is ready' });
  await expect(ready, 'registering must mint a key and show its recovery kit')
    .toBeVisible({ timeout: GATE_TIMEOUT });
  await ready.getByRole('checkbox').check();
  await ready.getByRole('button', { name: 'Done' }).click();
  await expect(ready).toBeHidden({ timeout: GATE_TIMEOUT });
}

/** This device's stored keyring record for `userId`, or null if it holds none. */
export async function readKeystoreRecord(
  page: Page,
  userId: string,
): Promise<KeystoreRecord | null> {
  return page.evaluate(readRecordInPage, {
    dbName: KEYSTORE_DB,
    storeName: KEYSTORE_STORE,
    userId,
  });
}

/** Whether this browser context holds a keyring for anyone. */
export async function hasAnyKeyring(page: Page): Promise<boolean> {
  return page.evaluate(countRecordsInPage, {
    dbName: KEYSTORE_DB,
    storeName: KEYSTORE_STORE,
  }).then((count) => count > 0);
}

/**
 * Wait until the keyring for `userId` has reached this device's key store.
 *
 * `setUpEncryption` returns once the UI is done, but the write it triggers is
 * what the encrypted paths actually wait on, so anything asserting on ciphertext
 * should gate on this rather than on the modal closing.
 */
export async function waitForKeyring(
  page: Page,
  userId: string,
  timeout = GATE_TIMEOUT,
): Promise<void> {
  await expect
    .poll(async () => (await readKeystoreRecord(page, userId)) !== null, {
      timeout,
      message: `no keyring stored for ${userId} in ${KEYSTORE_DB}`,
    })
    .toBe(true);
}

/**
 * The active identity keypair, unwrapped out of this device's key store.
 *
 * Only device-wrapped records can be opened here, which is every record the
 * tests create: the wrapping key travels in the record beside the ciphertext it
 * opens (see `DeviceParams` in `keystoreLocal.ts`). A passkey- or passphrase-
 * wrapped record cannot be opened without the secret behind it, so it throws
 * rather than pretending to.
 */
export async function activeKeyPair(page: Page, userId: string): Promise<E2EEKeyPair> {
  const record = await readKeystoreRecord(page, userId);
  if (!record) throw new Error(`no keyring stored for ${userId}`);
  if (record.method !== 'device' || !record.params.key) {
    throw new Error(`keyring for ${userId} is ${record.method}-wrapped and cannot be opened here`);
  }

  await sodium.ready;
  const key = fromBase64url(record.params.key);
  const raw = fromBase64url(record.blob);
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  const plaintext = sodium.crypto_secretbox_open_easy(
    raw.slice(nonceLen),
    raw.slice(0, nonceLen),
    key,
  );

  // Serialised form from `keyring.ts` — secret keys only; publics are derived.
  const serialised = JSON.parse(new TextDecoder().decode(plaintext)) as {
    entries: { version: number; sk: string; retiredAt: string | null }[];
  };
  const active = serialised.entries.find((e) => e.retiredAt === null);
  if (!active) throw new Error(`keyring for ${userId} has no active entry`);

  const secretKey = fromBase64url(active.sk);
  return {
    publicKey: toBase64url(sodium.crypto_scalarmult_base(secretKey)),
    secretKey: active.sk,
  };
}

/**
 * A Drive file's bytes as its owner's browser sees them: downloaded and, when
 * the file is encrypted, decrypted with the DEK sealed to the owner's keyring.
 *
 * Every editor's save is E2EE, so what `GET /api/v1/drive/files/{id}` returns
 * is ciphertext — including for a raw .docx/.xlsx/.pptx edited in place, whose
 * bytes are re-encrypted like any other save (issue #95). A test that wants to
 * assert on the *file*, rather than on what the server holds, has to do what
 * Drive's download does client-side, which is this.
 *
 * A file with no key ref was never encrypted; its stored bytes come back as-is.
 */
export async function downloadDecrypted(
  page: Page,
  request: APIRequestContext,
  opts: { baseUrl: string; token: string; userId: string; fileId: string },
): Promise<Buffer> {
  const { baseUrl, token, userId, fileId } = opts;
  const headers = { Authorization: `Bearer ${token}` };

  const contentRes = await request.get(`${baseUrl}/api/v1/drive/files/${fileId}`, { headers });
  expect(contentRes.ok(), `download failed: ${contentRes.status()}`).toBeTruthy();
  const stored = Buffer.from(await contentRes.body());

  const keyRes = await request.get(`${baseUrl}/api/v1/drive/files/${fileId}/key`, { headers });
  if (keyRes.status() === 404) return stored;
  expect(keyRes.ok(), `file key fetch failed: ${keyRes.status()}`).toBeTruthy();
  const { encryptedFileKey } = (await keyRes.json()) as { encryptedFileKey: string };

  const keyPair = await activeKeyPair(page, userId);
  await initSodium();
  const dek = decryptFileKey(
    encryptedFileKey,
    fromBase64url(keyPair.publicKey),
    fromBase64url(keyPair.secretKey),
  );
  return Buffer.from(decryptFile(new Uint8Array(stored), dek));
}

function fromBase64url(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

// ── In-page IndexedDB readers ────────────────────────────────────────────────
//
// Both refuse to *create* the database. `indexedDB.open(name)` on a name that
// does not exist creates it at version 1 with no object stores, and the app's
// own open — also version 1 — would then skip `onupgradeneeded` and find no
// store, breaking the very thing under test. So existence is checked first.

async function readRecordInPage(
  args: { dbName: string; storeName: string; userId: string },
): Promise<KeystoreRecord | null> {
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === args.dbName)) return null;

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(args.dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (!db.objectStoreNames.contains(args.storeName)) return null;
    return await new Promise<KeystoreRecord | null>((resolve, reject) => {
      const request = db
        .transaction(args.storeName, 'readonly')
        .objectStore(args.storeName)
        .get(args.userId);
      request.onsuccess = () => resolve((request.result as KeystoreRecord) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function countRecordsInPage(
  args: { dbName: string; storeName: string },
): Promise<number> {
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === args.dbName)) return 0;

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(args.dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (!db.objectStoreNames.contains(args.storeName)) return 0;
    return await new Promise<number>((resolve, reject) => {
      const request = db
        .transaction(args.storeName, 'readonly')
        .objectStore(args.storeName)
        .count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
