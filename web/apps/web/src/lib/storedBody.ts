/**
 * Reading a stored body that should be ciphertext but might not be.
 *
 * A native document is created by `POST /api/v1/drive/files`, which seeds the
 * body with the default content registered for its mime type
 * (`native_types.rs`) — in the clear, because the server holds no DEK. The
 * client is what turns that into ciphertext: the editor mints a key on first
 * open and writes the body back encrypted. Between those two moments the body
 * is plaintext at rest, and so is every file created before E2EE landed.
 *
 * Editors used to tell the two apart with `isNewEncryption` — "this session
 * minted the key, so what is stored must still be plaintext". That reads the
 * *session*, not the file, and it is wrong for the case in the middle: a
 * document created and then closed or reloaded before the sealing write lands
 * keeps its key ref but keeps its plaintext body too, and on the next open
 * `isNewEncryption` is false. The editor then treats the seed as unreadable
 * ciphertext, and nothing ever seals it.
 *
 * So decide from the bytes instead. Ciphertext that fails to open is
 * indistinguishable from random noise: it decodes to valid UTF-8 only by
 * accident, and parses as the JSON body of a document essentially never. That
 * asymmetry is what makes this safe in the direction that matters — a body we
 * cannot decrypt is reported as unreadable (the caller must not overwrite it)
 * rather than handed back as content.
 */

import { decryptFile } from '@neutrino/e2e-crypto';

export interface StoredBodyRead {
  /** The body as text, decrypted if it needed it. */
  text: string;
  /**
   * `true` when the stored bytes were already plaintext. The caller holds a
   * DEK, so this is a body that still needs sealing — write it back encrypted.
   */
  wasPlaintext: boolean;
}

/**
 * Whether `text` is the plaintext body of a document rather than ciphertext
 * that happened to decode. Every native body — doc, sheet, slide, note,
 * diagram, drawing — is JSON, so parsing it is the test.
 */
export function looksLikeJsonBody(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a stored body, decrypting it when it is ciphertext.
 *
 * Throws the decryption error when the bytes open with neither reading — they
 * are ciphertext this key cannot unwrap, and the caller's job then is to leave
 * them alone rather than replace them.
 *
 * `looksLikePlaintext` overrides the JSON test for a body that isn't JSON.
 */
export function readStoredBody(
  stored: Uint8Array,
  dek: Uint8Array,
  looksLikePlaintext: (text: string) => boolean = looksLikeJsonBody,
): StoredBodyRead {
  try {
    return {
      text: new TextDecoder().decode(decryptFile(stored, dek)),
      wasPlaintext: false,
    };
  } catch (decryptionError) {
    let text: string;
    try {
      // `fatal` so ciphertext that isn't valid UTF-8 is rejected here rather
      // than arriving as a string full of replacement characters.
      text = new TextDecoder('utf-8', { fatal: true }).decode(stored);
    } catch {
      throw decryptionError;
    }
    if (!looksLikePlaintext(text)) throw decryptionError;
    return { text, wasPlaintext: true };
  }
}
