/**
 * The only way to put user content into Drive.
 *
 * Issue #95: files were arriving in Drive unencrypted, and an unencrypted file
 * is not a file with a temporary problem — it has no `file_key_refs` row, so
 * nothing ever comes back to encrypt it. Every occurrence traced to the same
 * shape of code:
 *
 *     const kp = loadKeyPair(userId);
 *     if (kp) { …encrypt and write… } else { …write plaintext… }
 *
 * written a dozen times, each one individually defensible ("better a saved
 * file than a lost one") and collectively the bug. The `else` is the bug: it
 * turns a recoverable state (locked vault, key still on another device) into
 * an unrecoverable one (a file that can never be encrypted).
 *
 * So the fix is not another audit of those branches — it is removing the
 * function they call. `driveAutosaveContent`, `driveCreateVersion` and
 * `storageApi.uploadFile` used to live in `client.ts`; they are gone, and what
 * follows is what replaced them. There is no longer a plaintext write to fall
 * back *to*, which is what makes this hold for code nobody has written yet.
 *
 * The rule every function here follows: **no key, no write.** A missing key
 * raises `MissingEncryptionKeyError`, callers surface
 * `ENCRYPTION_WARNING_MESSAGE`, and the user unlocks and saves again with
 * nothing lost — the editor still holds the content.
 *
 * The two deliberate exceptions, both binary and both keyed by an explicit
 * `dek` argument the caller had to obtain: `driveAutosaveEncryptedBytes` and
 * `driveCreateEncryptedVersionBytes` in `client.ts`. They encrypt too; they
 * just take the key rather than resolving it.
 */

import type { FileItem, FileVersionItem } from './types';
import {
  encryptionApi,
  uploadEncryptedFile,
  driveAutosaveEncryptedContent,
  driveCreateEncryptedVersion,
  type AutosaveTransport,
} from './client';
import type { ContentVersionCheck } from '@neutrino/api-core';
import { generateThumbnail } from '@neutrino/utils';

/**
 * This device cannot encrypt right now: the vault is locked, or the keyring
 * never reached this browser.
 *
 * The message is the literal string `'no-dek'` because that is the sentinel the
 * editors' `onError` handlers already match on to raise
 * `ENCRYPTION_WARNING_MESSAGE`. Match on `instanceof MissingEncryptionKeyError`
 * in new code; the string is kept so the existing handlers keep working.
 */
export class MissingEncryptionKeyError extends Error {
  constructor() {
    super('no-dek');
    this.name = 'MissingEncryptionKeyError';
  }
}

/** True for the error above, however it crossed a module boundary. */
export function isMissingEncryptionKey(err: unknown): boolean {
  return err instanceof MissingEncryptionKeyError
    || (err instanceof Error && err.message === 'no-dek');
}

interface ResolvedKeyPair {
  publicKey: Uint8Array;
  keyVersion: number | undefined;
}

/**
 * The signed-in user's active keypair, or a throw.
 *
 * `userId` is nullable on purpose: nearly every caller reads it from a hook
 * that starts undefined, and pushing that check in here means no caller can
 * decide for itself that a missing user is a reason to write plaintext.
 */
async function requireKeyPair(userId: string | null | undefined): Promise<ResolvedKeyPair> {
  if (!userId) throw new MissingEncryptionKeyError();
  const { initSodium, loadKeyPair, activeKeyVersion } = await import('@neutrino/e2e-crypto');
  await initSodium();
  const kp = loadKeyPair(userId);
  if (!kp) throw new MissingEncryptionKeyError();
  return { publicKey: kp.publicKey, keyVersion: activeKeyVersion(userId) ?? undefined };
}

/** Whether this device could encrypt for `userId` right now. Never throws. */
export async function canEncryptFor(userId: string | null | undefined): Promise<boolean> {
  try {
    await requireKeyPair(userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mint a DEK for a file that has none and register it, returning the key.
 *
 * This is what an editor's first save does, and what every "Make a copy" has
 * to do: the copy is a new Drive row with no key of its own, so writing its
 * content before this point is precisely how a duplicate came out unencrypted.
 */
export async function mintFileKey(
  userId: string | null | undefined,
  fileId: string,
): Promise<Uint8Array> {
  const { publicKey, keyVersion } = await requireKeyPair(userId);
  const { generateFileKey, encryptFileKey } = await import('@neutrino/e2e-crypto');
  const dek = generateFileKey();
  await encryptionApi.setFileKey(fileId, {
    encryptedFileKey: encryptFileKey(dek, publicKey),
    keyVersion,
  });
  return dek;
}

/**
 * The DEK for `fileId` — the registered one, or a freshly minted one if the
 * file has never had a key.
 *
 * Returns `isNew` so a caller reading content can tell the two apart: an
 * existing key means whatever is stored is ciphertext, while a freshly minted
 * one means the stored bytes are still the plaintext this key will replace on
 * the next write. Getting that backwards renders ciphertext as text.
 */
export async function requireFileKey(
  userId: string | null | undefined,
  fileId: string,
): Promise<{ dek: Uint8Array; isNew: boolean }> {
  // Resolve the keypair first: on a locked session this throws before the
  // request, rather than after a needless round trip.
  await requireKeyPair(userId);
  const keyRef = await encryptionApi.getFileKey(fileId);
  if (keyRef) {
    const { initSodium, openSealedFileKey } = await import('@neutrino/e2e-crypto');
    await initSodium();
    return {
      dek: openSealedFileKey(userId!, keyRef.encryptedFileKey, keyRef.keyVersion),
      isNew: false,
    };
  }
  return { dek: await mintFileKey(userId, fileId), isNew: true };
}

export interface UploadDriveFileOptions {
  folderId?: string | null;
  onProgress?: (percent: number) => void;
  /**
   * Preview bytes for the grid. The server cannot make one — it holds only
   * ciphertext — so images get one generated here unless the caller passes its
   * own. Pass `null` to suppress that.
   */
  thumbnailB64?: string | null;
}

/**
 * Upload a file to Drive, encrypted. The replacement for
 * `storageApi.uploadFile`, which wrote plaintext and no longer exists.
 *
 * Everything a Drive file needs is done here rather than at the call site,
 * because the call sites are where it went wrong: one forgot the thumbnail,
 * another the encrypted metadata, several the encryption.
 */
export async function uploadDriveFile(
  file: File,
  userId: string | null | undefined,
  opts: UploadDriveFileOptions = {},
): Promise<FileItem> {
  const { publicKey, keyVersion } = await requireKeyPair(userId);
  const { generateFileKey, encryptFileKey, encryptMetadata } = await import('@neutrino/e2e-crypto');

  const dek = generateFileKey();
  const mimeType = file.type || 'application/octet-stream';
  const encryptedMetadata = encryptMetadata({ name: file.name, mimeType }, dek);

  // `undefined` means "decide for me"; `null` means "no thumbnail".
  const thumbnailB64 = opts.thumbnailB64 !== undefined
    ? opts.thumbnailB64
    : await generateThumbnailIfImage(file);

  return uploadEncryptedFile(
    file,
    dek,
    encryptFileKey(dek, publicKey),
    encryptedMetadata,
    opts.onProgress,
    opts.folderId,
    thumbnailB64,
    keyVersion,
  );
}

/**
 * A thumbnail is a nicety — a blank tile in the grid, not a lost file — so a
 * failure here is swallowed. It must never be the reason an upload does not
 * happen.
 */
async function generateThumbnailIfImage(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    return await generateThumbnail(file);
  } catch {
    return null;
  }
}

/**
 * Write JSON content to an existing file, encrypted, without adding a version
 * history entry. The replacement for `driveAutosaveContent`.
 *
 * `dek` is optional so both kinds of caller fit: an editor that already holds
 * the file's key passes it, and a one-shot writer (a duplicate, an import)
 * omits it and has it resolved here.
 */
export async function autosaveEncrypted(
  fileId: string,
  content: string,
  filename: string,
  userId: string | null | undefined,
  opts: {
    dek?: Uint8Array | null;
    versionCheck?: ContentVersionCheck;
    transport?: AutosaveTransport;
  } = {},
): Promise<FileItem> {
  const dek = opts.dek ?? (await requireFileKey(userId, fileId)).dek;
  return driveAutosaveEncryptedContent(
    fileId, content, filename, dek, opts.versionCheck, opts.transport,
  );
}

/**
 * Write JSON content to an existing file, encrypted, and snapshot it in version
 * history. The replacement for `driveCreateVersion`.
 */
export async function createEncryptedVersion(
  fileId: string,
  content: string,
  filename: string,
  userId: string | null | undefined,
  opts: { dek?: Uint8Array | null; label?: string } = {},
): Promise<FileVersionItem> {
  const dek = opts.dek ?? (await requireFileKey(userId, fileId)).dek;
  return driveCreateEncryptedVersion(fileId, content, filename, dek, opts.label);
}
