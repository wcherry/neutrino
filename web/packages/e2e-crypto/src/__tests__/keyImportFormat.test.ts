/**
 * Key files are not all written by the same hand.
 *
 * The web export emits standard base64; the mobile key QR and the iOS app emit
 * base64url, unpadded. All three are valid exports of the same thing, so the
 * decoder behind the "import a key" box has to read all three. It used to be a
 * bare `atob`, which throws on `-` and `_` — so a genuine key file was rejected
 * whenever one of its 32 bytes happened to encode as either character.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { initSodium, toBase64, toBase64url, keyPairMatches, generateKeyPair } from '../crypto';
import { fromBase64 } from '../keystore';

beforeAll(async () => {
  await initSodium();
});

/**
 * A real exported key pair, base64url and unpadded — the shape that was being
 * turned away. Its private half contains both `-` and `_`.
 */
const REPORTED_FILE = {
  public_key: '4rcgiEnQYAZEN67l6HTNKtxwjlyPbSzR2GgGyNAXll8',
  private_key: 'djJ-jz_I_qGTZTbuUmj93J-jXdQ15W8iin-T_b2x4IA',
  key_version: '1',
};

describe('decoding a pasted key file', () => {
  it('reads the base64url file that was being rejected', () => {
    const publicKey = fromBase64(REPORTED_FILE.public_key);
    const secretKey = fromBase64(REPORTED_FILE.private_key);

    expect(publicKey).toHaveLength(32);
    expect(secretKey).toHaveLength(32);
    // Not merely decodable — a real pair, so rejecting it was the bug.
    expect(keyPairMatches(publicKey, secretKey)).toBe(true);
  });

  it('reads standard base64, with padding, as it always did', () => {
    const kp = generateKeyPair();
    expect(Array.from(fromBase64(toBase64(kp.publicKey)))).toEqual(Array.from(kp.publicKey));
    expect(Array.from(fromBase64(toBase64(kp.secretKey)))).toEqual(Array.from(kp.secretKey));
  });

  it('reads either alphabet as the same bytes', () => {
    // A key whose encoding differs between the two alphabets — otherwise the
    // test passes without exercising the translation at all.
    let kp = generateKeyPair();
    while (!/[-_]/.test(toBase64url(kp.secretKey))) kp = generateKeyPair();

    expect(Array.from(fromBase64(toBase64url(kp.secretKey)))).toEqual(Array.from(kp.secretKey));
    expect(Array.from(fromBase64(toBase64(kp.secretKey)))).toEqual(Array.from(kp.secretKey));
  });

  it('still refuses something that is not base64 at all', () => {
    expect(() => fromBase64('this is not a key')).toThrow();
  });
});

describe('keyPairMatches', () => {
  it('accepts a pair that belongs together', () => {
    const kp = generateKeyPair();
    expect(keyPairMatches(kp.publicKey, kp.secretKey)).toBe(true);
  });

  it('rejects halves taken from two different keys', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(keyPairMatches(a.publicKey, b.secretKey)).toBe(false);
  });

  it('rejects a key of the wrong length rather than throwing', () => {
    const kp = generateKeyPair();
    expect(keyPairMatches(kp.publicKey.slice(0, 16), kp.secretKey)).toBe(false);
  });

  it('agrees with libsodium about how the public half is derived', () => {
    const kp = generateKeyPair();
    const derived = sodium.crypto_scalarmult_base(kp.secretKey);
    expect(Array.from(derived)).toEqual(Array.from(kp.publicKey));
  });
});
