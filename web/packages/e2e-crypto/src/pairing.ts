'use client';

/**
 * Moving the keyring to a second device, offline, in two QR codes.
 *
 * The build this replaces put the whole keypair in one QR, encrypted under
 * PBKDF2 over a short PIN. Anyone who photographed that QR held the identity
 * behind a few digits — seconds on a GPU. That was tolerable while the server
 * vault was the real enrolment path and the QR was a convenience; with the vault
 * gone this *is* enrolment, so it has to carry the weight.
 *
 * The direction inverts. The **receiver** shows the first code:
 *
 *   1. receiver  generates an ephemeral X25519 keypair, shows QR-A
 *                = { ephemeral public key, session nonce }
 *   2. sender    scans QR-A, seals its keyring to that public key, shows QR-B
 *                = { sealed keyring }
 *   3. receiver  scans QR-B, opens it with the ephemeral secret key
 *   4. both      display the same 6-digit code; the user confirms they match
 *
 * Photographing either code yields nothing: QR-A is a public key, and QR-B can
 * only be opened by the ephemeral secret half, which never left the receiver.
 *
 * Step 4 is what a passive photograph cannot defeat but an *active* relay could
 * — someone substituting their own ephemeral key in QR-A and re-sealing to the
 * real receiver would sit invisibly in the middle. The confirmation code is
 * derived from both halves of the transcript, so a relay produces two different
 * codes and the humans see it. It is a short authentication string, not a PIN:
 * it authenticates a channel that already exists rather than protecting a blob
 * at rest, which is why six digits is enough.
 *
 * Nothing here touches the network. A keyring of five versions is about 250
 * base64 characters against a QR's ~2,900 alphanumeric capacity, so the payload
 * fits directly and no relay is needed.
 */

import sodium from 'libsodium-wrappers';
import { deserializeKeyring, serializeKeyring, type Keyring } from './keyring';

const NONCE_BYTES = 16;
const SAS_DIGITS = 6;

/** QR-A — what the receiving device displays. */
export interface PairingOffer {
  t: 'neutrino-pair-offer';
  v: 1;
  /** base64url ephemeral X25519 public key. */
  pk: string;
  /** base64url, 16 random bytes binding this exchange to this attempt. */
  n: string;
}

/** QR-B — what the sending device displays in reply. */
export interface PairingResponse {
  t: 'neutrino-pair-response';
  v: 1;
  /** base64url sealed-box ciphertext of the serialised keyring. */
  ct: string;
  /** Echo of the offer's nonce, so a stale QR-B is detected rather than opened. */
  n: string;
}

/** Held by the receiver between showing QR-A and scanning QR-B. */
export interface PairingSession {
  offer: PairingOffer;
  ephemeralPublicKey: Uint8Array;
  ephemeralSecretKey: Uint8Array;
}

/**
 * Encode/decode UTF-8 without libsodium's `from_string`/`to_string`.
 *
 * Those return a `Uint8Array` from libsodium's own realm, which its argument
 * checks then reject via `instanceof` — so `crypto_box_seal(sodium.from_string(x))`
 * throws "unsupported input type for message" under some bundlers and test
 * environments. `TextEncoder` output, copied into a local `Uint8Array`, is
 * always accepted.
 */
function utf8(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text));
}

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function unb64u(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/**
 * The 6-digit code both devices show.
 *
 * Derived from the full transcript — offer nonce, offer public key, and the
 * ciphertext actually exchanged — so a relay that substituted its own ephemeral
 * key cannot make both ends agree. Length-prefixed for the same reason as
 * `pinning.ts`: the parts are variable-length and must not be able to slide
 * across each other.
 */
export function confirmationCode(offer: PairingOffer, response: PairingResponse): string {
  const encoder = new TextEncoder();
  const parts = ['neutrino-pair-sas-v1', offer.n, offer.pk, response.ct];
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const part of parts) {
    const bytes = encoder.encode(part);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, bytes.length, false);
    chunks.push(header, bytes);
    total += header.length + bytes.length;
  }
  const input = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }

  const digest = sodium.crypto_generichash(32, input);
  // Fold four bytes into a number, then take the low digits. Modulo bias across
  // 2^32 into 10^6 is negligible and the code is not a secret — it only has to
  // differ when the transcripts differ.
  const value =
    ((digest[0] << 24) >>> 0) + (digest[1] << 16) + (digest[2] << 8) + digest[3];
  return String(value % 10 ** SAS_DIGITS).padStart(SAS_DIGITS, '0');
}

// ── Receiver ──────────────────────────────────────────────────────────────────

/** Step 1. Mint the ephemeral pair and build QR-A. */
export function createPairingSession(): PairingSession {
  const kp = sodium.crypto_box_keypair();
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  return {
    offer: {
      t: 'neutrino-pair-offer',
      v: 1,
      pk: b64u(kp.publicKey),
      n: b64u(nonce),
    },
    ephemeralPublicKey: kp.publicKey,
    ephemeralSecretKey: kp.privateKey,
  };
}

/**
 * Step 3. Open QR-B and recover the keyring.
 *
 * Rejects a response whose nonce is not this session's — that is a QR left on
 * screen from an earlier attempt, and opening it would install a keyring the
 * user did not just approve.
 */
export function acceptPairingResponse(
  session: PairingSession,
  response: PairingResponse,
  userId: string,
): Keyring {
  if (response.t !== 'neutrino-pair-response' || response.v !== 1) {
    throw new Error('That is not a Neutrino pairing code');
  }
  if (response.n !== session.offer.n) {
    throw new Error('This code is from a different pairing attempt — start again');
  }

  const opened = sodium.crypto_box_seal_open(
    unb64u(response.ct),
    session.ephemeralPublicKey,
    session.ephemeralSecretKey,
  );
  if (!opened) {
    throw new Error('Could not read the pairing code — it may be damaged');
  }

  const keyring = deserializeKeyring(JSON.parse(fromUtf8(opened)));
  opened.fill(0);

  if (keyring.userId !== userId) {
    throw new Error('That key belongs to a different account');
  }
  return keyring;
}

/** Wipe the ephemeral secret once pairing finishes or is abandoned. */
export function closePairingSession(session: PairingSession): void {
  session.ephemeralSecretKey.fill(0);
  session.ephemeralPublicKey.fill(0);
}

// ── Sender ────────────────────────────────────────────────────────────────────

/** Parse a scanned QR-A. */
export function parsePairingOffer(raw: string): PairingOffer {
  let parsed: PairingOffer;
  try {
    parsed = JSON.parse(raw.trim()) as PairingOffer;
  } catch {
    throw new Error('That is not a Neutrino pairing code');
  }
  if (parsed?.t !== 'neutrino-pair-offer' || parsed.v !== 1) {
    throw new Error('That is not a Neutrino pairing code');
  }
  if (unb64u(parsed.pk).length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error('This pairing code is damaged');
  }
  return parsed;
}

/** Step 2. Seal the keyring to the offer's ephemeral key and build QR-B. */
export function respondToPairingOffer(keyring: Keyring, offer: PairingOffer): PairingResponse {
  const plaintext = utf8(JSON.stringify(serializeKeyring(keyring)));
  const sealed = sodium.crypto_box_seal(plaintext, unb64u(offer.pk));
  plaintext.fill(0);

  return {
    t: 'neutrino-pair-response',
    v: 1,
    ct: b64u(sealed),
    n: offer.n,
  };
}

/** Parse a scanned QR-B. */
export function parsePairingResponse(raw: string): PairingResponse {
  let parsed: PairingResponse;
  try {
    parsed = JSON.parse(raw.trim()) as PairingResponse;
  } catch {
    throw new Error('That is not a Neutrino pairing code');
  }
  if (parsed?.t !== 'neutrino-pair-response' || parsed.v !== 1) {
    throw new Error('That is not a Neutrino pairing code');
  }
  return parsed;
}

/** Both QR payloads travel as compact JSON. */
export function encodePairingPayload(payload: PairingOffer | PairingResponse): string {
  return JSON.stringify(payload);
}
