/**
 * Starting a document from a template (issue #128).
 *
 * A template is a `.dotx` in Drive, sealed under its own key like every other
 * file, so "use this template" is a copy that only the browser can make: read
 * the template's ciphertext, open it with the template's DEK, and write the
 * package into a new `.docx` sealed under a key minted for that document. The
 * server sees two ciphertexts and nothing else.
 *
 * That is the design, not a workaround. The server-side templates API this
 * replaces (removed in #132) seeded the new file with the template's stored
 * body, which it could only do in the clear — it holds no DEK.
 *
 * The copy is the package itself, with the main part's content type flipped
 * back to a document (`setDocxPackageKind`). It does not go through the
 * editor's model: the bytes are already a document Word and the editor can
 * open, and a parse-and-rewrite would only be a chance to lose something a
 * template from Word carries that the editor does not model.
 */

import { decryptFile, initSodium } from '@neutrino/e2e-crypto';
import {
  docsApi,
  driveReadBytes,
  driveCreateEncryptedVersionBytes,
  mintFileKey,
  canEncryptFor,
} from '@/lib/api';
import { withOoxmlExtension } from '@/lib/officeFormats';
import { looksLikeOoxml } from '@/lib/ooxmlContainer';
import { resolveDek } from '@/lib/documentContent';
import { setDocxPackageKind } from '@/lib/ooxml/docx/packageKind';

/** Thrown when the session cannot encrypt, so no document should be created. */
export class TemplateEncryptionUnavailableError extends Error {
  constructor() {
    super('encryption-unavailable');
    this.name = 'TemplateEncryptionUnavailableError';
  }
}

/**
 * The template's package, decrypted.
 *
 * A template with no key ref is plaintext — an upload from before E2EE, or one
 * whose key was never registered — and is used as stored. Ciphertext that the
 * key does not open is an error rather than a fallback: copying it would hand
 * the new document a body nobody can read.
 */
export async function readTemplatePackage(
  userId: string,
  templateId: string,
): Promise<Uint8Array> {
  const stored = await driveReadBytes(templateId);
  if (stored.byteLength === 0) return stored;
  const dek = await resolveDek(userId, templateId);
  if (!dek) {
    if (!looksLikeOoxml(stored)) throw new Error('template-unreadable');
    return stored;
  }
  await initSodium();
  try {
    return decryptFile(stored, dek);
  } catch {
    // A key ref minted for a file whose body was never re-sealed: the body is
    // still the plaintext upload. Anything else is genuinely unreadable.
    if (looksLikeOoxml(stored)) return stored;
    throw new Error('template-unreadable');
  }
}

export interface CreateDocFromTemplateOptions {
  userId: string | null | undefined;
  templateId: string;
  /** The new document's title, without an extension. */
  title: string;
  folderId?: string | null;
}

/**
 * Create a new document holding `templateId`'s content, and return its id.
 *
 * Encryption is checked before anything is created, so a locked vault leaves
 * no empty document behind — the same order `handleDuplicate` uses.
 */
export async function createDocFromTemplate({
  userId,
  templateId,
  title,
  folderId,
}: CreateDocFromTemplateOptions): Promise<string> {
  if (!userId || !(await canEncryptFor(userId))) {
    throw new TemplateEncryptionUnavailableError();
  }
  const template = await readTemplatePackage(userId, templateId);
  // An empty template is a blank document; the editor seals a zero-byte
  // `.docx` on open exactly as it does a newly created one.
  const body = template.byteLength === 0
    ? template
    : await setDocxPackageKind(template, 'document');

  const doc = await docsApi.createDoc({ title, folderId: folderId ?? null });
  if (body.byteLength > 0) {
    const dek = await mintFileKey(userId, doc.id);
    await driveCreateEncryptedVersionBytes(
      doc.id, body, withOoxmlExtension(title, 'docs'), dek,
    );
  }
  return doc.id;
}
