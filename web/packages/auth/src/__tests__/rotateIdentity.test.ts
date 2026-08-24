/**
 * Rotation has to archive the key it just retired.
 *
 * Until it did, a retired secret key existed in exactly one place — the
 * IndexedDB record on the browser that rotated — while the recovery kit printed
 * beforehand could not contain the *new* key and the mobile QR carries only the
 * active one. So a cleared profile took every file sealed before the rotation
 * with it. These tests pin the write down, and pin down the two things that
 * make it worth having: that what goes over the wire is openable with the new
 * key and nothing else, and that a rotation which cannot reach the server still
 * completes while saying so.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const putKeyFile = vi.fn();
const getKeyFile = vi.fn();
vi.mock('@neutrino/api-drive', () => ({
  keyFileApi: {
    putKeyFile: (body: unknown) => putKeyFile(body),
    getKeyFile: () => getKeyFile(),
  },
}));

const setPublicKey = vi.fn();
vi.mock('../client', () => ({
  authApi: { setPublicKey: (body: unknown) => setPublicKey(body) },
}));

// The real crypto throughout — the point of the round-trip assertion below is
// that these are genuine sealed boxes. Only the IndexedDB write is stubbed;
// jsdom has no store for it, and what reaches disk is not what is under test.
vi.mock('@neutrino/e2e-crypto', async () => {
  const actual = await vi.importActual<typeof import('@neutrino/e2e-crypto')>(
    '@neutrino/e2e-crypto',
  );
  return { ...actual, rewrapExisting: vi.fn().mockResolvedValue(undefined) };
});

import {
  initSodium,
  createKeyring,
  rotateKeyring,
  activeEntry,
  entryForVersion,
  openKeyFile,
  setSessionKeyring,
  getSessionKeyring,
  clearSession,
  type ArchivedKey,
  type Keyring,
} from '@neutrino/e2e-crypto';
import { rotateIdentity, backUpRetiredKeys, storedKeyFileVersions } from '../e2e-keys';

const USER = 'user-1';
const WRAPPING_KEY = new Uint8Array(32).fill(7);

/** The body of the last `putKeyFile` call. */
function storedKeys(): ArchivedKey[] {
  return (putKeyFile.mock.calls.at(-1)?.[0] as { keys: ArchivedKey[] }).keys;
}

function unlock(keyring: Keyring): Keyring {
  setSessionKeyring(keyring, WRAPPING_KEY);
  return keyring;
}

beforeAll(async () => {
  await initSodium();
});

beforeEach(() => {
  vi.clearAllMocks();
  clearSession();
  putKeyFile.mockResolvedValue({});
  getKeyFile.mockResolvedValue(null);
  setPublicKey.mockResolvedValue({});
});

describe('rotateIdentity', () => {
  it('writes a key file holding the version it just retired', async () => {
    unlock(createKeyring(USER));

    const result = await rotateIdentity(USER);

    expect(result.newVersion).toBe(2);
    expect(result.keyFileStored).toBe(true);
    expect(putKeyFile).toHaveBeenCalledTimes(1);
    expect(storedKeys().map((k) => k.keyVersion)).toEqual([1]);
  });

  it('re-archives every earlier version, not just the newest retiree', async () => {
    // Third rotation: v1 and v2 have to be re-sealed to v4, or a device holding
    // only the current key could open v3 and nothing older.
    unlock(rotateKeyring(rotateKeyring(createKeyring(USER))));

    await rotateIdentity(USER);

    expect(storedKeys().map((k) => k.keyVersion)).toEqual([1, 2, 3]);
  });

  it('stores keys the new identity can open, and the retired one cannot', async () => {
    const before = unlock(createKeyring(USER));
    const v1 = entryForVersion(before, 1)!;

    await rotateIdentity(USER);
    const after = getSessionKeyring(USER)!;

    const recovered = openKeyFile(storedKeys(), activeEntry(after));
    expect(recovered[0].secretKey).toEqual(v1.secretKey);
    // Sealed to the new key specifically — the old one is not a way in.
    expect(() => openKeyFile(storedKeys(), v1)).toThrow();
  });

  it('sends no plaintext secret key', async () => {
    const before = unlock(createKeyring(USER));
    const v1 = entryForVersion(before, 1)!;

    await rotateIdentity(USER);

    expect(JSON.stringify(storedKeys())).not.toContain(
      Buffer.from(v1.secretKey).toString('base64url'),
    );
  });

  it('publishes the new public key before archiving to it', async () => {
    unlock(createKeyring(USER));

    await rotateIdentity(USER);

    // The archive is sealed to the version being published, so writing it first
    // would file a backup against a key the account does not yet have.
    expect(setPublicKey.mock.invocationCallOrder[0]).toBeLessThan(
      putKeyFile.mock.invocationCallOrder[0],
    );
  });

  it('completes the rotation when the key file cannot be stored, and says so', async () => {
    unlock(createKeyring(USER));
    putKeyFile.mockRejectedValue(new Error('HTTP 503'));

    const result = await rotateIdentity(USER);

    // Failing here would abandon a rotation that already reached disk and the
    // server, leaving the session on a key the caller was told was never made.
    expect(result.newVersion).toBe(2);
    expect(result.recoveryKit).toBeTruthy();
    expect(result.keyFileStored).toBe(false);
    expect(activeEntry(getSessionKeyring(USER)!).version).toBe(2);
  });

  it('does not archive anything when the rotation itself fails', async () => {
    unlock(createKeyring(USER));
    setPublicKey.mockRejectedValue(new Error('HTTP 500'));

    await expect(rotateIdentity(USER)).rejects.toThrow();

    expect(putKeyFile).not.toHaveBeenCalled();
  });

  it('refuses to rotate a locked keyring, and writes nothing', async () => {
    await expect(rotateIdentity(USER)).rejects.toThrow(/Unlock/);

    expect(putKeyFile).not.toHaveBeenCalled();
    expect(setPublicKey).not.toHaveBeenCalled();
  });
});

/**
 * The retry.
 *
 * Rotation writes the archive as a side effect, so a rotation whose write fails
 * used to leave no way back except rotating again — which mints another version
 * to lose. That is not hypothetical: an account can end up several versions deep
 * with no key file on the server at all, every retired key living only in one
 * browser profile. These pin down the way out.
 */
describe('backUpRetiredKeys', () => {
  it('stores the retired keys without minting a version', async () => {
    const rotated = rotateKeyring(rotateKeyring(createKeyring(USER)));
    unlock(rotated);
    vi.clearAllMocks();

    const result = await backUpRetiredKeys(USER);

    expect(result.versions).toEqual([1, 2]);
    expect(setPublicKey).not.toHaveBeenCalled();
    expect(storedKeys().map((k) => k.keyVersion)).toEqual([1, 2]);
  });

  it('seals to the active key, so only the current identity opens the archive', async () => {
    const rotated = rotateKeyring(createKeyring(USER));
    unlock(rotated);

    await backUpRetiredKeys(USER);

    const active = activeEntry(rotated);
    const recovered = openKeyFile(storedKeys(), active);
    expect(recovered.map((k) => k.version)).toEqual([1]);
    expect(Array.from(recovered[0].secretKey)).toEqual(
      Array.from(entryForVersion(rotated, 1)!.secretKey),
    );
  });

  it('reports the reason rather than a boolean, because a user asked for this one', async () => {
    unlock(rotateKeyring(createKeyring(USER)));
    putKeyFile.mockRejectedValue(new Error('Network request failed'));

    await expect(backUpRetiredKeys(USER)).rejects.toThrow('Network request failed');
  });

  it('writes nothing for an account that has never rotated', async () => {
    unlock(createKeyring(USER));

    const result = await backUpRetiredKeys(USER);

    // The server rejects an empty key file, correctly — that is what DELETE is
    // for — so this must not be sent at all rather than sent and refused.
    expect(result.versions).toEqual([]);
    expect(putKeyFile).not.toHaveBeenCalled();
  });

  it('refuses when the keyring is locked, rather than storing an empty file', async () => {
    clearSession();
    await expect(backUpRetiredKeys(USER)).rejects.toThrow('Unlock your encryption key first');
  });
});

describe('storedKeyFileVersions', () => {
  it('reports what the server holds, ascending', async () => {
    getKeyFile.mockResolvedValue({
      userId: USER,
      keys: [
        { keyVersion: 2, encryptedKey: 'b' },
        { keyVersion: 1, encryptedKey: 'a' },
      ],
      createdAt: '',
      updatedAt: '',
    });

    expect(await storedKeyFileVersions()).toEqual([1, 2]);
  });

  /**
   * Null, not empty. "The server has no key file" is the state this exists to
   * make visible, and it has to be distinguishable from a file that happens to
   * hold nothing.
   */
  it('reports null when the account has no key file at all', async () => {
    getKeyFile.mockResolvedValue(null);

    expect(await storedKeyFileVersions()).toBeNull();
  });
});
