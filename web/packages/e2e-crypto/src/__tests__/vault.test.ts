import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { initSodium, generateKeyPair, encryptFileKey, decryptFileKey } from '../crypto';
import {
  generateMasterKey,
  wrapIdentity,
  unwrapIdentity,
  openVault,
  buildSecretUnlock,
  unwrapWithSecret,
  toBase64urlBytes,
  type VaultBundle,
} from '../vault';
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  looksLikeRecoveryCode,
} from '../recovery';
import { newArgon2Params, deriveKek } from '../kdf';
import {
  saveKeyPair,
  loadKeyPair,
  hasKeyPair,
  clearKeyPair,
  readLegacyKeyPair,
  hasLegacyKeyPair,
  clearLegacyKeyPair,
} from '../keystore';

// Argon2id at the real cost parameters is deliberately slow; these tests use
// the shipped defaults so they exercise what production actually runs.
const SLOW = 30_000;

beforeAll(async () => {
  await initSodium();
});

function makeVault(secret: string): Promise<{ vault: VaultBundle; secretKey: Uint8Array }> {
  const { publicKey, secretKey } = generateKeyPair();
  const masterKey = generateMasterKey();
  return buildSecretUnlock(masterKey, secret, 'password', 'Password').then((unlock) => ({
    secretKey,
    vault: {
      encryptedIdentity: wrapIdentity(secretKey, masterKey),
      publicKey: toBase64urlBytes(publicKey),
      version: 1,
      unlocks: [unlock],
    },
  }));
}

// ---------------------------------------------------------------------------
// Envelope round-trip
// ---------------------------------------------------------------------------

describe('identity envelope', () => {
  it('unwraps to exactly the key that was wrapped', () => {
    const { secretKey } = generateKeyPair();
    const masterKey = generateMasterKey();

    const recovered = unwrapIdentity(wrapIdentity(secretKey, masterKey), masterKey);

    expect(Array.from(recovered)).toEqual(Array.from(secretKey));
  });

  it('fails rather than returning garbage under the wrong master key', () => {
    const { secretKey } = generateKeyPair();
    const blob = wrapIdentity(secretKey, generateMasterKey());

    expect(() => unwrapIdentity(blob, generateMasterKey())).toThrow(/Decryption failed/);
  });

  it('detects a tampered ciphertext', () => {
    const { secretKey } = generateKeyPair();
    const masterKey = generateMasterKey();
    const blob = wrapIdentity(secretKey, masterKey);

    // Flip a bit in the middle of the base64url payload.
    const chars = [...blob];
    const i = Math.floor(chars.length / 2);
    chars[i] = chars[i] === 'A' ? 'B' : 'A';

    expect(() => unwrapIdentity(chars.join(''), masterKey)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// openVault — the consistency check that stops silent corruption
// ---------------------------------------------------------------------------

describe('openVault', () => {
  it(
    'returns the keypair when the wrapped secret matches the public key',
    async () => {
      const { vault, secretKey } = await makeVault('correct horse battery');
      const masterKey = await unwrapWithSecret(vault.unlocks[0], 'correct horse battery');

      const opened = openVault(vault, masterKey);

      expect(Array.from(opened.secretKey)).toEqual(Array.from(secretKey));
    },
    SLOW,
  );

  it(
    'rejects a vault whose public key does not match its wrapped secret',
    async () => {
      const { vault } = await makeVault('correct horse battery');
      const masterKey = await unwrapWithSecret(vault.unlocks[0], 'correct horse battery');

      // Someone swapped the advertised public key for another user's.
      const impostor = generateKeyPair();
      const tampered = { ...vault, publicKey: toBase64urlBytes(impostor.publicKey) };

      expect(() => openVault(tampered, masterKey)).toThrow(/does not match/);
    },
    SLOW,
  );

  it(
    'yields a key that actually opens sealed boxes for its public key',
    async () => {
      const { vault } = await makeVault('correct horse battery');
      const masterKey = await unwrapWithSecret(vault.unlocks[0], 'correct horse battery');
      const { publicKey, secretKey } = openVault(vault, masterKey);

      const dek = sodium.randombytes_buf(32);
      const sealed = encryptFileKey(dek, publicKey);

      expect(Array.from(decryptFileKey(sealed, publicKey, secretKey))).toEqual(Array.from(dek));
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// Password / recovery-code unlock
// ---------------------------------------------------------------------------

describe('secret-based unlock', () => {
  it(
    'recovers the master key with the right password',
    async () => {
      const masterKey = generateMasterKey();
      const unlock = await buildSecretUnlock(masterKey, 'hunter2hunter2', 'password', 'Password');

      const recovered = await unwrapWithSecret(unlock, 'hunter2hunter2');

      expect(Array.from(recovered)).toEqual(Array.from(masterKey));
    },
    SLOW,
  );

  it(
    'rejects the wrong password',
    async () => {
      const unlock = await buildSecretUnlock(
        generateMasterKey(),
        'hunter2hunter2',
        'password',
        'Password',
      );

      await expect(unwrapWithSecret(unlock, 'hunter3hunter3')).rejects.toThrow(
        /Decryption failed/,
      );
    },
    SLOW,
  );

  it(
    'wraps the same master key under two methods, both of which open it',
    async () => {
      const masterKey = generateMasterKey();
      const code = generateRecoveryCode();

      const [pw, rc] = await Promise.all([
        buildSecretUnlock(masterKey, 'hunter2hunter2', 'password', 'Password'),
        buildSecretUnlock(masterKey, normalizeRecoveryCode(code), 'recovery', 'Recovery code'),
      ]);

      // Different ciphertexts (independent salts and nonces)...
      expect(pw.encryptedMasterKey).not.toEqual(rc.encryptedMasterKey);
      // ...opening onto the same master key. This is what lets a method be
      // added or revoked without re-keying the identity.
      const viaPassword = await unwrapWithSecret(pw, 'hunter2hunter2');
      const viaRecovery = await unwrapWithSecret(rc, normalizeRecoveryCode(code));
      expect(Array.from(viaPassword)).toEqual(Array.from(masterKey));
      expect(Array.from(viaRecovery)).toEqual(Array.from(masterKey));
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// KDF
// ---------------------------------------------------------------------------

describe('deriveKek', () => {
  it(
    'is deterministic for the same secret and params',
    async () => {
      const params = newArgon2Params();
      const a = await deriveKek('same-secret', params);
      const b = await deriveKek('same-secret', params);

      expect(Array.from(a)).toEqual(Array.from(b));
      expect(a).toHaveLength(32);
    },
    SLOW,
  );

  it(
    'gives different keys for the same password under different salts',
    async () => {
      const a = await deriveKek('same-secret', newArgon2Params());
      const b = await deriveKek('same-secret', newArgon2Params());

      expect(Array.from(a)).not.toEqual(Array.from(b));
    },
    SLOW,
  );

  it('refuses an unrecognised KDF rather than falling back', async () => {
    const params = { ...newArgon2Params(), kdf: 'pbkdf2' as unknown as 'argon2id' };

    await expect(deriveKek('secret', params)).rejects.toThrow(/Unsupported KDF/);
  });
});

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

describe('recovery codes', () => {
  it('generates 24 characters in six readable groups', () => {
    const code = generateRecoveryCode();

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(24);
  });

  it('does not repeat', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(50);
  });

  it('folds the characters Crockford excludes onto their lookalikes', () => {
    // A code transcribed by hand with O for zero and I/l for one still works.
    expect(normalizeRecoveryCode('O1IL')).toBe('0111');
    expect(normalizeRecoveryCode('u')).toBe('V');
  });

  it('is insensitive to case, spaces and dashes', () => {
    const code = generateRecoveryCode();
    const mangled = `  ${code.toLowerCase().replace(/-/g, ' ')}  `;

    expect(normalizeRecoveryCode(mangled)).toBe(normalizeRecoveryCode(code));
  });

  it('recognises its own codes and rejects other strings', () => {
    expect(looksLikeRecoveryCode(generateRecoveryCode())).toBe(true);
    expect(looksLikeRecoveryCode('not-a-code')).toBe(false);
    expect(looksLikeRecoveryCode('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session keystore — the sync contract the app's dozen call sites rely on
// ---------------------------------------------------------------------------

describe('session keystore', () => {
  it('returns null until unlocked, then the keypair, then null again', () => {
    clearKeyPair();
    expect(loadKeyPair('user-1')).toBeNull();
    expect(hasKeyPair('user-1')).toBe(false);

    const { publicKey, secretKey } = generateKeyPair();
    saveKeyPair('user-1', publicKey, secretKey);

    expect(hasKeyPair('user-1')).toBe(true);
    expect(loadKeyPair('user-1')?.secretKey).toBeDefined();

    clearKeyPair();
    expect(loadKeyPair('user-1')).toBeNull();
  });

  it('does not hand one user the key of whoever was signed in before', () => {
    clearKeyPair();
    const { publicKey, secretKey } = generateKeyPair();
    saveKeyPair('user-1', publicKey, secretKey);

    expect(loadKeyPair('user-2')).toBeNull();
    expect(hasKeyPair('user-2')).toBe(false);
  });

  it('writes nothing to localStorage', () => {
    clearKeyPair();
    localStorage.clear();
    const { publicKey, secretKey } = generateKeyPair();

    saveKeyPair('user-1', publicKey, secretKey);

    expect(localStorage.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Migration off the old plaintext keystore
// ---------------------------------------------------------------------------

describe('legacy plaintext keystore', () => {
  const USER = 'legacy-user';
  const KEY = `neutrino_e2e_${USER}`;

  it('reads a keypair left by the pre-vault build', () => {
    const { publicKey, secretKey } = generateKeyPair();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        publicKey: toBase64urlBytes(publicKey),
        secretKey: toBase64urlBytes(secretKey),
      }),
    );

    expect(hasLegacyKeyPair(USER)).toBe(true);
    const recovered = readLegacyKeyPair(USER);
    expect(Array.from(recovered!.secretKey)).toEqual(Array.from(secretKey));

    clearLegacyKeyPair(USER);
    expect(hasLegacyKeyPair(USER)).toBe(false);
    expect(readLegacyKeyPair(USER)).toBeNull();
  });

  it('ignores a malformed or wrong-length entry instead of throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(readLegacyKeyPair(USER)).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ publicKey: 'AAAA', secretKey: 'AAAA' }));
    expect(readLegacyKeyPair(USER)).toBeNull();

    localStorage.removeItem(KEY);
  });
});
