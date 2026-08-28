import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sodium from 'libsodium-wrappers';
import { initSodium, encryptFileKey, generateFileKey } from '../crypto';
import {
  createKeyring,
  keyringFromKeyPair,
  activeEntry,
  entryForVersion,
  rotateKeyring,
  serializeKeyring,
  deserializeKeyring,
} from '../keyring';
import { exportRecoveryKit, importRecoveryKit, looksLikeRecoveryKit } from '../recoveryKit';
import {
  setSessionKeyring,
  clearSession,
  getSessionKeyPair,
  getSessionKeyPairForVersion,
  getActiveKeyVersion,
} from '../session';
import { openSealedFileKey, loadKeyPair } from '../keystore';
import {
  createPairingSession,
  respondToPairingOffer,
  acceptPairingResponse,
  parsePairingOffer,
  parsePairingResponse,
  encodePairingPayload,
  confirmationCode,
} from '../pairing';

const USER = 'user-1';

beforeAll(async () => {
  await initSodium();
});

beforeEach(() => {
  clearSession();
});

describe('keyring', () => {
  it('starts at version 1, active', () => {
    const keyring = createKeyring(USER);
    expect(keyring.entries).toHaveLength(1);
    expect(activeEntry(keyring).version).toBe(1);
  });

  it('rotates to a new active version and retires the previous one', () => {
    const rotated = rotateKeyring(createKeyring(USER));

    expect(activeEntry(rotated).version).toBe(2);
    expect(entryForVersion(rotated, 1)?.retiredAt).not.toBeNull();
    expect(rotated.entries).toHaveLength(2);
  });

  it('does not mutate the keyring it rotates', () => {
    // A caller that fails to persist the result must not have silently lost the
    // key that was active a moment ago.
    const original = createKeyring(USER);
    const before = activeEntry(original).version;

    rotateKeyring(original);

    expect(activeEntry(original).version).toBe(before);
    expect(original.entries).toHaveLength(1);
  });

  it('mints a genuinely different key on rotation', () => {
    const original = createKeyring(USER);
    const rotated = rotateKeyring(original);

    expect(entryForVersion(rotated, 2)!.secretKey).not.toEqual(
      entryForVersion(rotated, 1)!.secretKey,
    );
  });

  it('returns null for a version this keyring does not hold', () => {
    expect(entryForVersion(createKeyring(USER), 7)).toBeNull();
  });

  it('adopts an existing keypair as version 1 rather than minting one', () => {
    // Minting instead would orphan every file already sealed to the imported key.
    const kp = sodium.crypto_box_keypair();
    const keyring = keyringFromKeyPair(USER, kp.publicKey, kp.privateKey);

    expect(activeEntry(keyring).secretKey).toEqual(kp.privateKey);
  });
});

describe('keyring serialisation', () => {
  it('round-trips every version', () => {
    const keyring = rotateKeyring(rotateKeyring(createKeyring(USER)));
    const restored = deserializeKeyring(serializeKeyring(keyring));

    expect(restored.entries.map((e) => e.version)).toEqual([1, 2, 3]);
    expect(restored.entries.map((e) => e.secretKey)).toEqual(
      keyring.entries.map((e) => e.secretKey),
    );
    expect(activeEntry(restored).version).toBe(3);
  });

  it('derives public keys rather than trusting stored ones', () => {
    // Nothing carries a public half, so a corrupted kit cannot produce a pair
    // whose halves disagree and whose seals are silently unopenable.
    const keyring = createKeyring(USER);
    const serialized = serializeKeyring(keyring);

    expect(JSON.stringify(serialized)).not.toContain('pk');
    expect(deserializeKeyring(serialized).entries[0].publicKey).toEqual(
      keyring.entries[0].publicKey,
    );
  });

  it('rejects a keyring with no active entry', () => {
    const bad = serializeKeyring(createKeyring(USER));
    bad.entries[0].retiredAt = '2026-01-01T00:00:00Z';

    expect(() => deserializeKeyring(bad)).toThrow(/exactly one active key/);
  });

  it('rejects a keyring with two active entries', () => {
    const bad = serializeKeyring(rotateKeyring(createKeyring(USER)));
    bad.entries[0].retiredAt = null;

    expect(() => deserializeKeyring(bad)).toThrow(/exactly one active key/);
  });

  it('rejects a secret key of the wrong length', () => {
    const bad = serializeKeyring(createKeyring(USER));
    bad.entries[0].sk = 'AAAA';

    expect(() => deserializeKeyring(bad)).toThrow(/wrong length/);
  });

  it('rejects duplicate versions', () => {
    const bad = serializeKeyring(rotateKeyring(createKeyring(USER)));
    bad.entries[1].version = 1;

    expect(() => deserializeKeyring(bad)).toThrow(/duplicate/);
  });
});

describe('recovery kit', () => {
  it('round-trips a single-version keyring', () => {
    const keyring = createKeyring(USER);
    const restored = importRecoveryKit(exportRecoveryKit(keyring), USER);

    expect(restored.entries[0].secretKey).toEqual(keyring.entries[0].secretKey);
  });

  it('carries every version, so files sealed before a rotation stay readable', () => {
    const keyring = rotateKeyring(rotateKeyring(createKeyring(USER)));
    const restored = importRecoveryKit(exportRecoveryKit(keyring), USER);

    expect(restored.entries.map((e) => e.version)).toEqual([1, 2, 3]);
    expect(restored.entries.map((e) => e.secretKey)).toEqual(
      keyring.entries.map((e) => e.secretKey),
    );
    expect(activeEntry(restored).version).toBe(3);
  });

  it('survives the transcription mistakes its alphabet exists to absorb', () => {
    // Crockford's point is that O/0, I/1, L/1 and U/V are recoverable — someone
    // copying off paper writes the letter regardless of the alphabet.
    const keyring = createKeyring(USER);
    const kit = exportRecoveryKit(keyring);
    const mangled = kit.toLowerCase().replace(/0/g, 'O').replace(/1/g, 'l');

    expect(importRecoveryKit(mangled, USER).entries[0].secretKey).toEqual(
      keyring.entries[0].secretKey,
    );
  });

  it('ignores the whitespace and grouping it prints for legibility', () => {
    const keyring = createKeyring(USER);
    const kit = exportRecoveryKit(keyring);

    expect(importRecoveryKit(kit.replace(/[-\n]/g, ' '), USER).entries[0].secretKey).toEqual(
      keyring.entries[0].secretKey,
    );
  });

  it('reports a truncated kit rather than yielding a wrong key', () => {
    const kit = exportRecoveryKit(createKeyring(USER));

    expect(() => importRecoveryKit(kit.slice(0, 20), USER)).toThrow(/incomplete/);
  });

  it('rejects text that is not a kit at all', () => {
    expect(() => importRecoveryKit('hello there', USER)).toThrow();
    expect(looksLikeRecoveryKit('hello there')).toBe(false);
    expect(looksLikeRecoveryKit(exportRecoveryKit(createKeyring(USER)))).toBe(true);
  });
});

describe('session key resolution', () => {
  it('hands out the active key for sealing new work', () => {
    const keyring = rotateKeyring(createKeyring(USER));
    setSessionKeyring(keyring);

    expect(getActiveKeyVersion(USER)).toBe(2);
    expect(loadKeyPair(USER)!.secretKey).toEqual(entryForVersion(keyring, 2)!.secretKey);
  });

  it('hands out an older key when asked for it by version', () => {
    const keyring = rotateKeyring(createKeyring(USER));
    setSessionKeyring(keyring);

    expect(getSessionKeyPairForVersion(USER, 1)!.secretKey).toEqual(
      entryForVersion(keyring, 1)!.secretKey,
    );
  });

  it('returns the same keypair object on every read', () => {
    // `useSessionKeyPair` feeds this to `useSyncExternalStore`, which compares
    // snapshots by identity — a fresh object per read is an infinite render
    // loop and the photo editor never mounts (issue #149).
    const keyring = rotateKeyring(createKeyring(USER));
    setSessionKeyring(keyring);

    expect(getSessionKeyPair(USER)).toBe(getSessionKeyPair(USER));
    expect(getSessionKeyPairForVersion(USER, 1)).toBe(getSessionKeyPairForVersion(USER, 1));
    expect(getSessionKeyPair(USER)).toBe(getSessionKeyPairForVersion(USER, 2));
  });

  it('hands out a fresh keypair object after the session is replaced', () => {
    setSessionKeyring(createKeyring(USER));
    const first = getSessionKeyPair(USER);

    clearSession();
    setSessionKeyring(createKeyring(USER));

    expect(getSessionKeyPair(USER)).not.toBe(first);
  });

  it('does not serve one account’s keyring to another', () => {
    // On a shared machine a stale keyring would decrypt into the wrong session
    // and re-seal DEKs to the wrong identity.
    setSessionKeyring(createKeyring(USER));

    expect(getSessionKeyPair('someone-else')).toBeNull();
  });

  it('opens a DEK sealed to a retired version after rotation', () => {
    // The whole point of keeping old versions: a file sealed before a rotation
    // must still open afterwards.
    const original = createKeyring(USER);
    const dek = generateFileKey();
    const sealed = encryptFileKey(dek, activeEntry(original).publicKey);

    const rotated = rotateKeyring(original);
    setSessionKeyring(rotated);

    expect(openSealedFileKey(USER, sealed, 1)).toEqual(dek);
  });

  it('names the missing version instead of failing to decrypt', () => {
    setSessionKeyring(createKeyring(USER));

    expect(() => openSealedFileKey(USER, 'whatever', 4)).toThrow(/version 4/);
  });

  it('reports a locked session distinctly from a missing version', () => {
    expect(() => openSealedFileKey(USER, 'whatever', 1)).toThrow(/locked/);
  });

  it('wipes the keyring on lock', () => {
    setSessionKeyring(createKeyring(USER));
    clearSession();

    expect(loadKeyPair(USER)).toBeNull();
  });
});

describe('device pairing', () => {
  function pair(keyring = createKeyring(USER)) {
    const session = createPairingSession();
    const offer = parsePairingOffer(encodePairingPayload(session.offer));
    const response = parsePairingResponse(
      encodePairingPayload(respondToPairingOffer(keyring, offer)),
    );
    return { session, offer, response, keyring };
  }

  it('carries the whole keyring to the receiving device', () => {
    const source = rotateKeyring(createKeyring(USER));
    const { session, response } = pair(source);

    const received = acceptPairingResponse(session, response, USER);

    expect(received.entries.map((e) => e.secretKey)).toEqual(
      source.entries.map((e) => e.secretKey),
    );
  });

  it('both ends compute the same confirmation code', () => {
    const { session, offer, response } = pair();

    expect(confirmationCode(offer, response)).toBe(confirmationCode(session.offer, response));
    expect(confirmationCode(offer, response)).toMatch(/^\d{6}$/);
  });

  it('a relay substituting its own ephemeral key produces a different code', () => {
    // This is the attack the spoken code exists to catch: the relay can complete
    // both halves, but it cannot make the two transcripts agree.
    const keyring = createKeyring(USER);
    const honest = pair(keyring);
    const relay = pair(keyring);

    expect(confirmationCode(honest.offer, honest.response)).not.toBe(
      confirmationCode(relay.offer, relay.response),
    );
  });

  it('refuses a response from a different pairing attempt', () => {
    const first = pair();
    const second = pair();

    expect(() => acceptPairingResponse(first.session, second.response, USER)).toThrow(
      /different pairing attempt/,
    );
  });

  it('refuses a keyring belonging to another account', () => {
    const { session, response } = pair();

    expect(() => acceptPairingResponse(session, response, 'someone-else')).toThrow(
      /different account/,
    );
  });

  it('a photographed offer alone does not open the response', () => {
    // QR-A is a public key; only the receiver holds the secret half.
    const { offer, response } = pair();
    const eavesdropper = createPairingSession();

    expect(() => acceptPairingResponse(eavesdropper, response, USER)).toThrow();
    expect(offer.pk).not.toBe(eavesdropper.offer.pk);
  });

  it('rejects payloads that are not pairing codes', () => {
    expect(() => parsePairingOffer('{"t":"something-else"}')).toThrow();
    expect(() => parsePairingOffer('not json')).toThrow();
  });
});
