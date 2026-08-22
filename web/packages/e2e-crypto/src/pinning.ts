'use client';

/**
 * Trust-on-first-use pinning for other people's public keys.
 *
 * Sharing seals a file's DEK to a public key the *server* hands us
 * (`GET /api/v1/auth/users/{id}/public-key`). Nothing in that response is signed
 * or bound to the user it claims to describe, and `POST /api/v1/auth/keys`
 * accepts any non-empty string, so a hostile or compromised server can answer
 * with a key it holds the secret half of and read every file shared afterwards.
 * The recipient never notices: they simply cannot open the file, which reads as
 * an ordinary decryption failure.
 *
 * No server-side change fixes this. Proof-of-possession on the *write* endpoint
 * stops one user claiming another's key, but the threat here is the server lying
 * on the *read*, and a server that lies on read does not care what it validated
 * on write. The only workable check is one the server cannot influence: remember
 * the key we saw the first time, keep that memory locally, and refuse to seal to
 * a different one until a human has confirmed the change out of band.
 *
 * Hence localStorage. It is the property being bought — the server can serve any
 * bytes it likes, but it cannot write to this origin's storage.
 *
 * Fingerprints are per-key, not per-pair. A pairwise safety number (Signal's
 * model) resists slightly more, but it requires both ends to hold a per-contact
 * UI before either can verify anything; a single-key fingerprint is readable off
 * one screen and comparable over the phone today. `fingerprintFor` binds the
 * user id into the hash, so a key replayed as a *different* user's still fails
 * to match.
 */

import sodium from 'libsodium-wrappers';

/** One remembered key. Written the first time we seal anything to a user. */
export interface PinnedKey {
  userId: string;
  /** base64url Curve25519 public key, exactly as the server returned it. */
  publicKey: string;
  /** ISO timestamp of first sight. */
  firstSeen: string;
  /** ISO timestamp of out-of-band confirmation, or null if merely trusted. */
  verifiedAt: string | null;
}

/** The verdict on a key the server has just offered us. */
export type PinCheck =
  /** Matches what we pinned. Seal without interrupting anyone. */
  | { status: 'trusted'; pinned: PinnedKey }
  /** Never seen this user before. Pin it and carry on — this is the T in TOFU. */
  | { status: 'unpinned' }
  /**
   * We hold a different key for this user. Do not seal. Either they rotated, or
   * the server is substituting a key; the two are indistinguishable from here,
   * which is exactly why a human has to decide.
   */
  | { status: 'changed'; pinned: PinnedKey; offered: string };

const STORE_PREFIX = 'neutrino:keypins:v1:';

/**
 * Pins are stored per *owner*, not globally.
 *
 * On a shared machine two accounts sign in against the same origin. Consulting
 * one user's pins while sealing as another would let a key trusted by the first
 * pass silently for the second, which is a trust decision nobody made.
 */
function storeKey(ownerId: string): string {
  return `${STORE_PREFIX}${ownerId}`;
}

type PinMap = Record<string, PinnedKey>;

function readAll(ownerId: string): PinMap {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(storeKey(ownerId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PinMap;
    // A corrupt or hand-edited store must not throw on every share attempt.
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeAll(ownerId: string, pins: PinMap): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storeKey(ownerId), JSON.stringify(pins));
}

// ── Fingerprints ──────────────────────────────────────────────────────────────

/** Crockford base32 — no I, L, O or U, so it survives being read aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FINGERPRINT_CHARS = 20; // 100 bits, in 5 groups of 4
const GROUP_SIZE = 4;

/**
 * Length-prefixed encoding, so no two distinct inputs share a hash preimage.
 *
 * Concatenating `userId + publicKey` directly would let ("ab", "cd") and
 * ("a", "bcd") collide — user ids are opaque strings and nothing stops one
 * ending where a key begins.
 */
function lengthPrefixed(...parts: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const part of parts) {
    const bytes = encoder.encode(part);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, bytes.length, false);
    chunks.push(header, bytes);
    total += header.length + bytes.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toCrockford(bytes: Uint8Array, chars: number): string {
  let bits = 0;
  let value = 0;
  const out: string[] = [];
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out.push(ALPHABET[(value >>> (bits - 5)) & 31]);
      bits -= 5;
    }
    if (out.length >= chars) break;
  }
  const groups: string[] = [];
  for (let i = 0; i < out.length; i += GROUP_SIZE) {
    groups.push(out.slice(i, i + GROUP_SIZE).join(''));
  }
  return groups.join('-');
}

/**
 * The human-comparable fingerprint for `userId`'s `publicKey`.
 *
 * Both ends derive this from values they already hold, so it needs no round
 * trip and the server cannot influence it without changing one of the inputs —
 * which is the change it is there to reveal.
 *
 * Requires `initSodium()` to have resolved.
 */
export function fingerprintFor(userId: string, publicKey: string): string {
  const input = lengthPrefixed('neutrino-key-fingerprint-v1', userId, publicKey);
  const digest = sodium.crypto_generichash(32, input);
  return toCrockford(digest, FINGERPRINT_CHARS);
}

// ── The pin store ─────────────────────────────────────────────────────────────

/**
 * Compare a server-offered key against what we remember for `recipientId`.
 *
 * Pure — call `pinKey` to actually record a decision.
 */
export function checkKey(ownerId: string, recipientId: string, offered: string): PinCheck {
  const pinned = readAll(ownerId)[recipientId];
  if (!pinned) return { status: 'unpinned' };
  if (pinned.publicKey === offered) return { status: 'trusted', pinned };
  return { status: 'changed', pinned, offered };
}

/**
 * Record `publicKey` as the key for `recipientId`, replacing any earlier pin.
 *
 * `verified` records whether a human actually compared fingerprints out of band,
 * as opposed to the key merely being the first one we happened to see. The
 * distinction is worth keeping: an unverified pin still detects a *later* swap,
 * but it cannot detect a server that lied from the very first share.
 */
export function pinKey(
  ownerId: string,
  recipientId: string,
  publicKey: string,
  verified = false,
): PinnedKey {
  const pins = readAll(ownerId);
  const now = new Date().toISOString();
  const existing = pins[recipientId];
  const pin: PinnedKey = {
    userId: recipientId,
    publicKey,
    // A re-pin after a rotation is still the first sight of *this* key, but the
    // relationship's age is the more useful thing to keep.
    firstSeen: existing?.firstSeen ?? now,
    verifiedAt: verified ? now : null,
  };
  pins[recipientId] = pin;
  writeAll(ownerId, pins);
  return pin;
}

/** Everything `ownerId` has pinned, newest first. For a settings listing. */
export function listPins(ownerId: string): PinnedKey[] {
  return Object.values(readAll(ownerId)).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
}

/** Drop a single pin, so the next share re-pins on first use. */
export function forgetPin(ownerId: string, recipientId: string): void {
  const pins = readAll(ownerId);
  delete pins[recipientId];
  writeAll(ownerId, pins);
}

/** Drop every pin held by `ownerId`. Called when their identity is replaced. */
export function clearPins(ownerId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(storeKey(ownerId));
}
