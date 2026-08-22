import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initSodium, generateKeyPair, toBase64url } from '../crypto';
import {
  fingerprintFor,
  checkKey,
  pinKey,
  listPins,
  forgetPin,
  clearPins,
} from '../pinning';

beforeAll(async () => {
  await initSodium();
});

beforeEach(() => {
  localStorage.clear();
});

function aKey(): string {
  return toBase64url(generateKeyPair().publicKey);
}

const ALICE = 'user-alice';
const BOB = 'user-bob';

describe('fingerprintFor', () => {
  it('is stable for the same inputs', () => {
    const key = aKey();
    expect(fingerprintFor(BOB, key)).toBe(fingerprintFor(BOB, key));
  });

  it('changes when the key changes', () => {
    expect(fingerprintFor(BOB, aKey())).not.toBe(fingerprintFor(BOB, aKey()));
  });

  it('binds the user id, so one key replayed as another user does not match', () => {
    const key = aKey();
    expect(fingerprintFor(BOB, key)).not.toBe(fingerprintFor('user-mallory', key));
  });

  it('cannot be collided by shifting the boundary between user id and key', () => {
    // Without length prefixing, ("ab", "cd") and ("a", "bcd") hash the same
    // input. User ids are opaque strings, so nothing stops one ending where a
    // key begins.
    expect(fingerprintFor('ab', 'cd')).not.toBe(fingerprintFor('a', 'bcd'));
  });

  it('renders as five readable groups from the Crockford alphabet', () => {
    const fp = fingerprintFor(BOB, aKey());
    expect(fp).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
  });
});

describe('checkKey', () => {
  it('reports an unknown recipient as unpinned', () => {
    expect(checkKey(ALICE, BOB, aKey())).toEqual({ status: 'unpinned' });
  });

  it('trusts a key matching the pin', () => {
    const key = aKey();
    pinKey(ALICE, BOB, key);

    const result = checkKey(ALICE, BOB, key);
    expect(result.status).toBe('trusted');
  });

  it('reports a different key as changed, carrying both for comparison', () => {
    const original = aKey();
    const substituted = aKey();
    pinKey(ALICE, BOB, original);

    const result = checkKey(ALICE, BOB, substituted);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') throw new Error('unreachable');
    expect(result.pinned.publicKey).toBe(original);
    expect(result.offered).toBe(substituted);
  });

  it('scopes pins per owner, so one account does not inherit another\'s trust', () => {
    // Two accounts on a shared machine share an origin. A key Alice trusts must
    // not pass silently while sealing as Carol.
    const key = aKey();
    pinKey(ALICE, BOB, key);

    expect(checkKey('user-carol', BOB, key)).toEqual({ status: 'unpinned' });
  });

  it('survives a corrupt store rather than throwing on every share', () => {
    localStorage.setItem('neutrino:keypins:v1:' + ALICE, 'not json');
    expect(checkKey(ALICE, BOB, aKey())).toEqual({ status: 'unpinned' });
  });
});

describe('pinKey', () => {
  it('records an unverified pin by default', () => {
    const pin = pinKey(ALICE, BOB, aKey());
    expect(pin.verifiedAt).toBeNull();
  });

  it('records the out-of-band confirmation when one was made', () => {
    const pin = pinKey(ALICE, BOB, aKey(), true);
    expect(pin.verifiedAt).not.toBeNull();
  });

  it('keeps the original firstSeen across a re-pin', () => {
    const first = pinKey(ALICE, BOB, aKey());
    const second = pinKey(ALICE, BOB, aKey(), true);
    expect(second.firstSeen).toBe(first.firstSeen);
  });

  it('replaces the key, so a confirmed rotation stops being flagged', () => {
    pinKey(ALICE, BOB, aKey());
    const rotated = aKey();
    pinKey(ALICE, BOB, rotated, true);

    expect(checkKey(ALICE, BOB, rotated).status).toBe('trusted');
  });
});

describe('listPins / forgetPin / clearPins', () => {
  it('lists every pin held by an owner', () => {
    pinKey(ALICE, BOB, aKey());
    pinKey(ALICE, 'user-dave', aKey());

    expect(listPins(ALICE).map((p) => p.userId).sort()).toEqual(['user-bob', 'user-dave']);
  });

  it('forgets one pin, leaving the rest', () => {
    pinKey(ALICE, BOB, aKey());
    pinKey(ALICE, 'user-dave', aKey());

    forgetPin(ALICE, BOB);

    expect(checkKey(ALICE, BOB, aKey())).toEqual({ status: 'unpinned' });
    expect(listPins(ALICE)).toHaveLength(1);
  });

  it('clears every pin for an owner without touching another owner', () => {
    pinKey(ALICE, BOB, aKey());
    pinKey('user-carol', BOB, aKey());

    clearPins(ALICE);

    expect(listPins(ALICE)).toHaveLength(0);
    expect(listPins('user-carol')).toHaveLength(1);
  });
});
