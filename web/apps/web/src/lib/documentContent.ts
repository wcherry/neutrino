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
import type { OoxmlApp } from '@neutrino/api-core';
import { looksLikeOoxml, readNeutrinoModel } from '@/lib/ooxmlContainer';

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
 * is stored for them is the *text* of that encoding; every other app writes
 * raw bytes. Try the encoded form first and fall back, exactly as the note
 * editor does.
 */
function decryptStored(stored: Uint8Array, dek: Uint8Array): Uint8Array {
  try {
    return decryptFile(fromBase64url(new TextDecoder().decode(stored)), dek);
  } catch {
    return decryptFile(stored, dek);
  }
}

/**
 * Decrypted bytes -> the text its editor serialized.
 *
 * Docs, Sheets and Slides store OOXML now (issue #127), so for those the body
 * is a zip and decoding it as UTF-8 gives back noise. What the callers here
 * want is the model — the same JSON the bespoke format stored directly.
 *
 * Two ways to get it, in this order. A package written before its app had a
 * real OOXML writer carries the model in a `neutrino/model.json` part, and that
 * is preferred where it exists because the OOXML beside it was only a
 * projection. Otherwise the model is *read out of the OOXML*, by the same
 * reader the editor opens the file with — which is what makes a preview of a
 * `.docx` or an `.xlsx` from anywhere show its contents rather than nothing.
 *
 * Slides has no such reader yet, so a deck with no model part still comes back
 * empty; its preview waits for the file to be opened and saved once. Both
 * readers are imported dynamically — a preview should not pull the OOXML
 * layer into the page that merely lists files.
 */
export async function bodyTextFromStored(
  plain: Uint8Array,
  app: OoxmlApp | undefined,
): Promise<string> {
  if (!app || !looksLikeOoxml(plain)) return new TextDecoder().decode(plain);
  const legacy = await readNeutrinoModel(plain, app);
  if (legacy) return legacy;
  try {
    if (app === 'sheets') {
      const { readXlsx } = await import('@/lib/ooxml/xlsx/read');
      return JSON.stringify(await readXlsx(plain));
    }
    if (app === 'docs') {
      const { readDocx } = await import('@/lib/ooxml/docx/read');
      return JSON.stringify((await readDocx(plain)).doc);
    }
  } catch {
    // Unreadable as its own format: a corrupt package, or one whose parts this
    // does not know. A preview showing nothing beats one showing an exception.
  }
  return '';
}

/**
 * The stored body of one document, as the text its editor serialized, for a
 * caller that already holds the file's DEK — the preview modal, which gets one
 * from `useEncryptedDocumentContent`.
 *
 * `dek` may be null (an unencrypted file), and decryption failing is not an
 * error either: a body written before E2EE, or one whose key was minted a
 * moment ago by the read that is about to seal it, is still plaintext.
 */
export async function readStoredDocumentBody(
  fileId: string,
  app: OoxmlApp | undefined,
  dek: Uint8Array | null,
): Promise<string> {
  const blob = await storageApi.downloadFile(fileId);
  const stored = new Uint8Array(await blob.arrayBuffer());
  if (!dek) return bodyTextFromStored(stored, app);
  try {
    return await bodyTextFromStored(decryptFile(stored, dek), app);
  } catch {
    return bodyTextFromStored(stored, app);
  }
}

/**
 * The decrypted body of a document, as text.
 *
 * Returns `''` rather than throwing when the file can't be read — a document
 * whose ciphertext is corrupt or whose key ref was revoked should drop out of
 * the index, not abort the run that was indexing it.
 *
 * `app` says which OOXML package to expect, for the three types that have one.
 * Omit it and the bytes are read as text, which is what every other type is.
 */
export async function readDocumentText(
  userId: string,
  fileId: string,
  app?: OoxmlApp,
): Promise<string> {
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

  if (!dek) return bodyTextFromStored(stored, app);

  try {
    return await bodyTextFromStored(decryptStored(stored, dek), app);
  } catch {
    return '';
  }
}
