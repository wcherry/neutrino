'use client';

/**
 * The recovery kit — the keyring on paper.
 *
 * With nothing stored server-side, this is the only copy of the identity that
 * survives losing every device. It is therefore the whole keyring, not just the
 * active key: a file sealed to version 1 needs version 1, and a kit that
 * restored only the newest key would come back to a library it cannot open.
 *
 * Encoding is a compact binary frame in Crockford base32, not the serialised
 * JSON. A three-version keyring is 108 bytes here against roughly 400 as JSON,
 * and the difference is what someone has to copy by hand without a transcription
 * error. The alphabet drops I, L, O and U so the common misreadings cannot
 * happen at all.
 *
 * Timestamps are deliberately not carried. They are display metadata, not key
 * material, and spending a third of the printed length on them would be paying
 * paper for something nobody needs to recover a file. Restored entries are
 * stamped with the moment of the restore instead.
 *
 * Because keyring entries are independently random (see `keyring.ts`), a kit
 * printed before a rotation cannot contain the key minted by it. Rotation must
 * prompt for a fresh export — `rotateIdentity` in `@neutrino/auth` is where that
 * is enforced.
 */

import sodium from 'libsodium-wrappers';
import type { Keyring, KeyringEntry } from './keyring';

/** Crockford base32 — no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP_SIZE = 4;
const GROUPS_PER_LINE = 8;

const MAGIC = 0x4e; // 'N'
const FORMAT_VERSION = 1;
const SECRET_KEY_BYTES = 32;
const ENTRY_BYTES = 2 /* version */ + SECRET_KEY_BYTES + 1 /* flags */;
const FLAG_RETIRED = 0x01;

// ── base32 ────────────────────────────────────────────────────────────────────

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Pad the trailing partial group with zero bits rather than dropping it —
  // those bits are key material.
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Recovery kit contains an unexpected character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Fold the common misreadings back before decoding.
 *
 * Crockford's whole point is that these characters are unambiguous *if* you map
 * them: someone copying off paper writes O for 0 and l for 1 regardless of what
 * the alphabet says.
 */
export function normalizeRecoveryKit(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

// ── Framing ───────────────────────────────────────────────────────────────────

function encodeFrame(keyring: Keyring): Uint8Array {
  const out = new Uint8Array(3 + keyring.entries.length * ENTRY_BYTES);
  out[0] = MAGIC;
  out[1] = FORMAT_VERSION;
  out[2] = keyring.entries.length;

  let offset = 3;
  for (const entry of keyring.entries) {
    out[offset] = (entry.version >>> 8) & 0xff;
    out[offset + 1] = entry.version & 0xff;
    out.set(entry.secretKey, offset + 2);
    out[offset + 2 + SECRET_KEY_BYTES] = entry.retiredAt === null ? 0 : FLAG_RETIRED;
    offset += ENTRY_BYTES;
  }
  return out;
}

function decodeFrame(bytes: Uint8Array, userId: string, now: string): Keyring {
  if (bytes.length < 3 || bytes[0] !== MAGIC) {
    throw new Error('This does not look like a Neutrino recovery kit');
  }
  if (bytes[1] !== FORMAT_VERSION) {
    throw new Error(`Unsupported recovery kit version: ${bytes[1]}`);
  }

  const count = bytes[2];
  const expected = 3 + count * ENTRY_BYTES;
  // A truncated kit is the likely outcome of copying by hand, so say that
  // rather than letting a short read produce a subtly wrong key.
  if (bytes.length < expected) {
    throw new Error('Recovery kit is incomplete — some characters are missing');
  }

  const entries: KeyringEntry[] = [];
  let offset = 3;
  for (let i = 0; i < count; i += 1) {
    const version = (bytes[offset] << 8) | bytes[offset + 1];
    const secretKey = bytes.slice(offset + 2, offset + 2 + SECRET_KEY_BYTES);
    const retired = (bytes[offset + 2 + SECRET_KEY_BYTES] & FLAG_RETIRED) !== 0;
    entries.push({
      version,
      publicKey: sodium.crypto_scalarmult_base(secretKey),
      secretKey,
      createdAt: now,
      retiredAt: retired ? now : null,
    });
    offset += ENTRY_BYTES;
  }

  const activeCount = entries.filter((e) => e.retiredAt === null).length;
  if (activeCount !== 1) {
    throw new Error('Recovery kit is damaged — it does not name exactly one active key');
  }

  entries.sort((a, b) => a.version - b.version);
  return { userId, entries };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render `keyring` as the printable kit.
 *
 * Grouped in fours and wrapped, because this is copied by eye: an unbroken
 * 170-character string is where transcription errors come from.
 */
export function exportRecoveryKit(keyring: Keyring): string {
  const encoded = encodeBase32(encodeFrame(keyring));

  const groups: string[] = [];
  for (let i = 0; i < encoded.length; i += GROUP_SIZE) {
    groups.push(encoded.slice(i, i + GROUP_SIZE));
  }

  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += GROUPS_PER_LINE) {
    lines.push(groups.slice(i, i + GROUPS_PER_LINE).join('-'));
  }
  return lines.join('\n');
}

/**
 * Rebuild a keyring from a printed kit.
 *
 * `userId` comes from the signed-in session rather than the kit: the kit holds
 * key material only, and binding it to an account is the caller's business.
 */
export function importRecoveryKit(
  text: string,
  userId: string,
  now = new Date().toISOString(),
): Keyring {
  const normalized = normalizeRecoveryKit(text);
  if (normalized.length === 0) {
    throw new Error('Enter your recovery kit');
  }
  return decodeFrame(decodeBase32(normalized), userId, now);
}

/** True if `text` could plausibly be a kit. For deciding which field to accept. */
export function looksLikeRecoveryKit(text: string): boolean {
  const normalized = normalizeRecoveryKit(text);
  if (normalized.length < 60) return false;
  return [...normalized].every((c) => ALPHABET.includes(c));
}
