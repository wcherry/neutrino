import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { initSodium, encryptFileKey, generateFileKey, decryptFileKey } from '../crypto';
import { createKeyring, rotateKeyring, activeEntry, entryForVersion } from '../keyring';
import { buildKeyFile, openKeyFile } from '../keyFile';

const USER = 'user-1';

beforeAll(async () => {
  await initSodium();
});

describe('buildKeyFile', () => {
  it('is empty before the first rotation, so nothing is stored', () => {
    expect(buildKeyFile(createKeyring(USER))).toEqual([]);
  });

  it('carries every version except the active one, ascending', () => {
    const keyring = rotateKeyring(rotateKeyring(rotateKeyring(createKeyring(USER))));

    expect(buildKeyFile(keyring).map((k) => k.keyVersion)).toEqual([1, 2, 3]);
    expect(activeEntry(keyring).version).toBe(4);
  });

  it('never puts a secret key on the wire', () => {
    const keyring = rotateKeyring(createKeyring(USER));
    const retired = entryForVersion(keyring, 1)!;

    const wire = JSON.stringify(buildKeyFile(keyring));
    const secretB64 = sodium.to_base64(
      retired.secretKey,
      sodium.base64_variants.URLSAFE_NO_PADDING,
    );
    expect(wire).not.toContain(secretB64);
  });

  it('stays inside the server’s per-entry size limit', () => {
    // MAX_ENCRYPTED_KEY_CHARS in src/drive/key_files/service.rs. A sealed
    // 32-byte key is ~107 chars; a build that blew past 4096 would be rejected
    // by the API rather than failing here, which is much harder to read.
    for (const key of buildKeyFile(rotateKeyring(createKeyring(USER)))) {
      expect(key.encryptedKey.length).toBeLessThan(4096);
      expect(key.encryptedKey.length).toBeGreaterThan(0);
    }
  });
});

describe('openKeyFile', () => {
  it('round-trips the retired secret keys', () => {
    const original = createKeyring(USER);
    const v1 = entryForVersion(original, 1)!;
    const keyring = rotateKeyring(original);

    const recovered = openKeyFile(buildKeyFile(keyring), activeEntry(keyring));

    expect(recovered).toHaveLength(1);
    expect(recovered[0].version).toBe(1);
    expect(recovered[0].secretKey).toEqual(v1.secretKey);
    expect(recovered[0].publicKey).toEqual(v1.publicKey);
  });

  /** The whole point: a file sealed before the rotation still opens afterwards. */
  it('recovers a key that still opens a DEK sealed to a retired version', () => {
    const original = createKeyring(USER);
    const dek = generateFileKey();
    const sealed = encryptFileKey(dek, activeEntry(original).publicKey);

    const keyring = rotateKeyring(rotateKeyring(original));
    const recovered = openKeyFile(buildKeyFile(keyring), activeEntry(keyring));

    const v1 = recovered.find((k) => k.version === 1)!;
    expect(decryptFileKey(sealed, v1.publicKey, v1.secretKey)).toEqual(dek);
  });

  it('opens with the newest key only, since every rotation re-seals the whole set', () => {
    const first = rotateKeyring(createKeyring(USER));
    const second = rotateKeyring(first);

    // The v2-sealed file, against the v3 identity: the wrong pairing.
    expect(() => openKeyFile(buildKeyFile(first), activeEntry(second))).toThrow(
      /was not sealed to key version 3/,
    );
    // And the right one, to show the failure above is about the pairing rather
    // than about either file being malformed.
    expect(openKeyFile(buildKeyFile(second), activeEntry(second))).toHaveLength(2);
  });

  it('rejects an entry whose declared public key is not its secret key’s', () => {
    const keyring = rotateKeyring(createKeyring(USER));
    const keys = buildKeyFile(keyring);
    keys[0].publicKey = sodium.to_base64(
      sodium.crypto_box_keypair().publicKey,
      sodium.base64_variants.URLSAFE_NO_PADDING,
    );

    expect(() => openKeyFile(keys, activeEntry(keyring))).toThrow(/does not match/);
  });

  it('rejects a tampered ciphertext rather than returning rubbish', () => {
    const keyring = rotateKeyring(createKeyring(USER));
    const keys = buildKeyFile(keyring);
    keys[0].encryptedKey = keys[0].encryptedKey.slice(0, -4) + 'AAAA';

    expect(() => openKeyFile(keys, activeEntry(keyring))).toThrow();
  });
});
