/**
 * `readStoredBody` decides whether a stored body is ciphertext or plaintext
 * from the bytes themselves. The editors act on that answer by writing — a
 * body reported as plaintext gets sealed, replacing what is stored — so the
 * direction that matters is the one where it must refuse: ciphertext this key
 * cannot open has to throw, never come back as content.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initSodium, encryptFile, generateFileKey } from '@neutrino/e2e-crypto';
import { readStoredBody, looksLikeJsonBody } from '@/lib/storedBody';

// `Uint8Array.from` re-wraps what jsdom's TextEncoder returns: libsodium
// rejects the array it hands back ("unsupported input type for message_chunk")
// because it comes from a different realm.
const encode = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

const DOC_BODY = JSON.stringify({ type: 'doc', content: [] });

describe('readStoredBody', () => {
  beforeAll(async () => {
    await initSodium();
  });

  it('decrypts a body that is ciphertext', () => {
    const dek = generateFileKey();
    const stored = encryptFile(encode(DOC_BODY), dek);

    const read = readStoredBody(stored, dek);

    expect(read.text).toBe(DOC_BODY);
    expect(read.wasPlaintext).toBe(false);
  });

  it('reads a body the server still holds in the clear', () => {
    const dek = generateFileKey();

    const read = readStoredBody(encode(DOC_BODY), dek);

    expect(read.text).toBe(DOC_BODY);
    expect(read.wasPlaintext).toBe(true);
  });

  it('throws on ciphertext written under a different key rather than reporting it as content', () => {
    const stored = encryptFile(encode(DOC_BODY), generateFileKey());

    expect(() => readStoredBody(stored, generateFileKey())).toThrow();
  });

  it('throws on bytes that are neither decryptable nor a plaintext body', () => {
    const dek = generateFileKey();
    // Valid UTF-8, so the decode succeeds — only the JSON test rejects it.
    const stored = encode('not a document body');

    expect(() => readStoredBody(stored, dek)).toThrow();
  });

  it('throws on undecryptable bytes that are not valid UTF-8', () => {
    const dek = generateFileKey();
    const stored = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x80, 0x81]);

    expect(() => readStoredBody(stored, dek)).toThrow();
  });

  it('accepts a non-JSON body when the caller supplies its own test', () => {
    const dek = generateFileKey();

    const read = readStoredBody(encode('plain note text'), dek, (text) =>
      text.startsWith('plain'),
    );

    expect(read).toEqual({ text: 'plain note text', wasPlaintext: true });
  });
});

describe('looksLikeJsonBody', () => {
  it('accepts the bodies the editors store', () => {
    expect(looksLikeJsonBody(DOC_BODY)).toBe(true);
    expect(looksLikeJsonBody(JSON.stringify({ sheets: [{ name: 'Sheet1' }] }))).toBe(true);
    expect(looksLikeJsonBody(JSON.stringify([{ type: 'text', text: 'a note' }]))).toBe(true);
  });

  it('rejects text that is not a body', () => {
    expect(looksLikeJsonBody('')).toBe(false);
    expect(looksLikeJsonBody('{"type":"doc"')).toBe(false);
  });
});
