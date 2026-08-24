import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { initSodium } from '../crypto';
import { createKeyring, rotateKeyring, activeEntry } from '../keyring';
import {
  exportKeyQr,
  openKeyQr,
  generateQrPin,
  expireQrPayload,
  MOBILE_QR_ITERATIONS,
  type MobileKeyQrEnvelope,
} from '../mobileKeyQr';

const USER = 'user-1';

beforeAll(async () => {
  await initSodium();
});

const unb64u = (s: string) => sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);

describe('envelope shape', () => {
  /**
   * These assertions are the contract with `KeyQRDecryptService.swift`. They
   * look pedantic, but each one is a field that file reads by name and rejects
   * the whole payload over.
   */
  it('matches exactly what the iOS decoder parses', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    const envelope = JSON.parse(qr.payload) as MobileKeyQrEnvelope;

    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe('pbkdf2-sha256+xsalsa20');
    expect(envelope.iter).toBe(MOBILE_QR_ITERATIONS);

    // Swift reads `v` and `iter` as Int — a JSON string would throw
    // unsupportedVersion even though the digits look right.
    expect(typeof envelope.v).toBe('number');
    expect(typeof envelope.iter).toBe('number');

    expect(unb64u(envelope.salt)).toHaveLength(16);
    expect(unb64u(envelope.nonce)).toHaveLength(sodium.crypto_secretbox_NONCEBYTES);
    expect(unb64u(envelope.nonce)).toHaveLength(24);
  });

  it('emits base64url without padding, which is what the Swift side re-pads', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    const envelope = JSON.parse(qr.payload) as MobileKeyQrEnvelope;
    for (const field of [envelope.salt, envelope.nonce, envelope.ct]) {
      expect(field).not.toMatch(/[=+/]/);
    }
  });
});

describe('round trip', () => {
  it('opens with the PIN it issued', async () => {
    const keyring = createKeyring(USER);
    const qr = await exportKeyQr(keyring);
    const inner = JSON.parse(await openKeyQr(qr.payload, qr.pin));

    expect(inner.public_key).toBe(
      sodium.to_base64(activeEntry(keyring).publicKey, sodium.base64_variants.URLSAFE_NO_PADDING),
    );
    expect(inner.private_key).toBe(
      sodium.to_base64(activeEntry(keyring).secretKey, sodium.base64_variants.URLSAFE_NO_PADDING),
    );
  });

  /**
   * The subtlest way this breaks. iOS casts the inner object to
   * `[String: String]`, so one numeric value makes the *entire* cast fail and
   * the user sees "The key file is missing required fields" — pointing at the
   * wrong problem entirely.
   */
  it('sends every inner field as a string', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    const inner = JSON.parse(await openKeyQr(qr.payload, qr.pin));

    expect(Object.keys(inner).sort()).toEqual(['key_version', 'private_key', 'public_key']);
    for (const value of Object.values(inner)) {
      expect(typeof value).toBe('string');
    }
    expect(inner.key_version).toBe('1');
  });

  it('carries a keypair iOS can validate by deriving the public half', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    const inner = JSON.parse(await openKeyQr(qr.payload, qr.pin));

    // Mirrors `KeyImportService.validateKeyPair`'s X25519 branch.
    const derived = sodium.crypto_scalarmult_base(unb64u(inner.private_key));
    expect(Array.from(derived)).toEqual(Array.from(unb64u(inner.public_key)));
  });

  it('refuses a wrong PIN', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    const wrong = qr.pin === '000000' ? '111111' : '000000';
    await expect(openKeyQr(qr.payload, wrong)).rejects.toThrow(/wrong PIN/i);
  });

  it('uses a fresh salt and nonce per export', async () => {
    const keyring = createKeyring(USER);
    const a = JSON.parse((await exportKeyQr(keyring)).payload) as MobileKeyQrEnvelope;
    const b = JSON.parse((await exportKeyQr(keyring)).payload) as MobileKeyQrEnvelope;

    expect(a.salt).not.toBe(b.salt);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe('PIN', () => {
  it('is six digits', () => {
    expect(generateQrPin()).toMatch(/^\d{6}$/);
  });

  it('covers every digit across many draws, so rejection sampling is not stuck', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const d of generateQrPin()) seen.add(d);
    }
    expect(seen.size).toBe(10);
  });
});

describe('rotation', () => {
  /**
   * The limitation the UI has to surface: iOS `KeyBundle` holds one keypair, so
   * a rotated account cannot hand the phone the versions its older files are
   * sealed to.
   */
  it('reports retired versions as omitted', async () => {
    const rotated = rotateKeyring(rotateKeyring(createKeyring(USER)));
    const qr = await exportKeyQr(rotated);

    expect(qr.keyVersion).toBe(3);
    expect(qr.omittedVersions).toEqual([1, 2]);
  });

  it('omits nothing before the first rotation', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    expect(qr.keyVersion).toBe(1);
    expect(qr.omittedVersions).toEqual([]);
  });

  it('sends the active version number, not a hardcoded 1', async () => {
    const qr = await exportKeyQr(rotateKeyring(createKeyring(USER)));
    const inner = JSON.parse(await openKeyQr(qr.payload, qr.pin));
    expect(inner.key_version).toBe('2');
  });
});

describe('expiry', () => {
  it('clears the payload and PIN', async () => {
    const qr = await exportKeyQr(createKeyring(USER));
    const expired = expireQrPayload(qr);

    expect(expired.payload).toBe('');
    expect(expired.pin).toBe('');
    expect(expired.keyVersion).toBe(qr.keyVersion);
  });
});
