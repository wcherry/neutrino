/**
 * Reading a document's stored body outside an editor.
 *
 * Doc/sheet/slide/note/diagram/drawing bodies are E2EE: the server holds
 * ciphertext and only the client can turn it back into text, by unwrapping the
 * file's DEK with the user's key pair. The editors each do this inline (see
 * `useEncryptedDocumentContent` and the content query in `DocEditor`); this is
 * the same read path for callers with no editor mounted — today the search
 * indexer, which has to read every document the user owns.
 *
 * Two deliberate differences from the editors' version:
 *
 *  - It never *creates* a DEK. A file with no key ref is simply not encrypted,
 *    and a missing key is no reason to start encrypting a file the user isn't
 *    editing.
 *  - It reads through `storageApi.downloadFile` rather than a document's
 *    `contentUrl`. Those are the same endpoint (`/api/v1/drive/files/{id}`, see
 *    `content_urls` in `src/docs/docs/service.rs`), so going by file id saves
 *    the indexer a metadata round-trip per document.
 */

import {
  initSodium,
  loadKeyPair,
  openSealedFileKey,
  decryptFile,
  fromBase64url,
} from '@neutrino/e2e-crypto';
import { encryptionApi, storageApi } from '@/lib/api';

/** Unwrapped DEK for `fileId`, or `null` when the file isn't encrypted. */
async function resolveDek(userId: string, fileId: string): Promise<Uint8Array | null> {
  await initSodium();
  const kp = loadKeyPair(userId);
  if (!kp) return null;
  const keyRef = await encryptionApi.getFileKey(fileId);
  if (!keyRef) return null;
  return openSealedFileKey(userId, keyRef.encryptedFileKey, keyRef.keyVersion);
}

/**
 * Decrypt stored bytes with `dek`.
 *
 * Notes send `toBase64url(cipherBytes)` rather than raw ciphertext, so what
 * comes back for them is the *text* of that encoding; every other app writes
 * raw bytes. Try the encoded form first and fall back, exactly as the note
 * editor does.
 */
function decryptStored(stored: Uint8Array, dek: Uint8Array): string {
  let plainBytes: Uint8Array;
  try {
    plainBytes = decryptFile(fromBase64url(new TextDecoder().decode(stored)), dek);
  } catch {
    plainBytes = decryptFile(stored, dek);
  }
  return new TextDecoder().decode(plainBytes);
}

/**
 * The decrypted body of a document, as text.
 *
 * Returns `''` rather than throwing when the file can't be read — a document
 * whose ciphertext is corrupt or whose key ref was revoked should drop out of
 * the index, not abort the run that was indexing it.
 */
export async function readDocumentText(userId: string, fileId: string): Promise<string> {
  let dek: Uint8Array | null = null;
  try {
    dek = await resolveDek(userId, fileId);
  } catch {
    // Key lookup failed — fall through and try to read the file as plaintext.
  }

  let stored: Uint8Array;
  try {
    const blob = await storageApi.downloadFile(fileId);
    stored = new Uint8Array(await blob.arrayBuffer());
  } catch {
    return '';
  }

  if (!dek) return new TextDecoder().decode(stored);

  try {
    return decryptStored(stored, dek);
  } catch {
    return '';
  }
}
