// @vitest-environment node
// libsodium's string encoding under jsdom yields a Uint8Array from jsdom's realm, which
// secretstream rejects ("unsupported input type"); browsers and Node have one realm.

import { describe, it, expect, beforeAll } from 'vitest';
import { initSodium, generateKeyPair } from '../crypto';
import {
  openPreferenceVault,
  preferenceVaultKeyVersion,
  sealPreferenceVault,
  PreferenceVaultError,
} from '../preferenceVault';

beforeAll(async () => {
  await initSodium();
});

const keys = () => generateKeyPair();

describe('the preference vault envelope', () => {
  const payload = { 'ai.apiKey': 'sk-test-1234', 'library.sheets.cfTemplates': [{ name: 'Overdue', rule: { op: '<' } }] };

  it('round-trips the payload and records the key version', () => {
    const k = keys();
    const blob = sealPreferenceVault(payload, k.publicKey, 3);
    expect(preferenceVaultKeyVersion(blob)).toBe(3);
    expect(openPreferenceVault(blob, k.publicKey, k.secretKey)).toEqual(payload);
  });

  it('is one base64url token, which is the only thing the server accepts', () => {
    const blob = sealPreferenceVault(payload, keys().publicKey, 1);
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries no plaintext', () => {
    const blob = sealPreferenceVault(payload, keys().publicKey, 1);
    const decoded = Buffer.from(blob, 'base64url').toString('utf8');
    expect(decoded).not.toContain('sk-test-1234');
    expect(decoded).not.toContain('Overdue');
  });

  it('will not open with another account’s key', () => {
    const blob = sealPreferenceVault(payload, keys().publicKey, 1);
    const other = keys();
    expect(() => openPreferenceVault(blob, other.publicKey, other.secretKey)).toThrow();
  });

  it('rejects a newer envelope version and non-envelopes by name', () => {
    const future = Buffer.from(JSON.stringify({ v: 2, keyVersion: 1, key: 'a', data: 'b' })).toString('base64url');
    expect(() => preferenceVaultKeyVersion(future)).toThrow(PreferenceVaultError);
    expect(() => preferenceVaultKeyVersion('bm90IGpzb24')).toThrow(PreferenceVaultError);
  });
});
