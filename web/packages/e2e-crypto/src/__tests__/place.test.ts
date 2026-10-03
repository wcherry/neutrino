// @vitest-environment node
// libsodium's string encoding under jsdom yields a Uint8Array from jsdom's realm, which
// secretstream rejects ("unsupported input type"); browsers and Node have one realm.
/**
 * The saved-place envelope (`place.ts`) against the vectors iOS also opens.
 *
 * `fixtures/place_envelope_vectors.json` is a copy of
 * `neutrino_calendar_ios_mobile/NeutrinoCalendarTests/Fixtures/place_envelope_vectors.json`,
 * generated there from this package's `crypto.ts` by `scripts/generate_place_envelope_vectors.mjs`.
 * Opening every case here and in the Swift tests is what keeps the two clients able to read
 * each other's places. Regenerate and copy it whenever the cases change.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initSodium, generateKeyPair } from '../crypto';
import { fromBase64url } from '../keystore';
import { openPlace, placeKeyVersion, sealPlace, PlaceEnvelopeError } from '../place';
import vectors from './fixtures/place_envelope_vectors.json';

beforeAll(async () => {
  await initSodium();
});

const keyFor = (version: number) => {
  const k = (vectors.keys as Record<string, { publicKey: string; secretKey: string }>)[String(version)];
  return { publicKey: fromBase64url(k.publicKey), secretKey: fromBase64url(k.secretKey) };
};

describe('the shared place envelope vectors', () => {
  for (const c of vectors.cases) {
    it(`opens "${c.name}"`, () => {
      const version = placeKeyVersion(c.encryptedPayload);
      expect(version).toBe(c.keyVersion);
      const { publicKey, secretKey } = keyFor(version);
      expect(openPlace(c.encryptedPayload, publicKey, secretKey)).toEqual(c.expected);
    });
  }

  for (const r of vectors.rejected) {
    it(`rejects "${r.name}" as ${r.error}`, () => {
      const { publicKey, secretKey } = keyFor(2);
      let thrown: unknown;
      try {
        openPlace(r.encryptedPayload, publicKey, secretKey);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(PlaceEnvelopeError);
      expect((thrown as PlaceEnvelopeError).code).toBe(r.error);
    });
  }

  it('does not open a case with another version’s key', () => {
    const retired = vectors.cases.find((c) => c.keyVersion === 1)!;
    const { publicKey, secretKey } = keyFor(2);
    expect(() => openPlace(retired.encryptedPayload, publicKey, secretKey)).toThrow();
  });
});

describe('sealPlace', () => {
  it('round-trips through openPlace and records the key version', () => {
    const keys = generateKeyPair();
    const payload = { name: 'Safeway on 5th', lat: 37.7749, lng: -122.4194, radiusM: 250 };
    const sealed = sealPlace(payload, keys.publicKey, 3);
    expect(placeKeyVersion(sealed)).toBe(3);
    expect(openPlace(sealed, keys.publicKey, keys.secretKey)).toEqual(payload);
  });

  it('keeps the name and coordinates out of the envelope', () => {
    const keys = generateKeyPair();
    const sealed = sealPlace({ name: 'Home', lat: 51.501364, lng: -0.14189, radiusM: 150 }, keys.publicKey, 1);
    expect(sealed).not.toContain('Home');
    expect(sealed).not.toContain('51.501364');
    expect(Object.keys(JSON.parse(sealed)).sort()).toEqual(['data', 'key', 'keyVersion', 'v']);
  });

  it('seals only the known fields', () => {
    const keys = generateKeyPair();
    const extra = { name: 'Gym', lat: 1, lng: 2, radiusM: 300, icon: 'dumbbell' } as never;
    expect(openPlace(sealPlace(extra, keys.publicKey, 1), keys.publicKey, keys.secretKey)).toEqual({
      name: 'Gym', lat: 1, lng: 2, radiusM: 300,
    });
  });

  it('uses a fresh key for every write', () => {
    const keys = generateKeyPair();
    const payload = { name: 'Home', lat: 1, lng: 2, radiusM: 150 };
    expect(sealPlace(payload, keys.publicKey, 1)).not.toBe(sealPlace(payload, keys.publicKey, 1));
  });
});
