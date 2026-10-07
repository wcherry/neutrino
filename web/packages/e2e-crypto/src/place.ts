/**
 * Saved-place envelope (v1): the end-to-end encrypted payload of a task place
 * (`task_places.encrypted_payload`). Built only from the primitives Drive files already use, so
 * the iOS apps open it with `DriveFileCrypto` and no new cryptography exists anywhere:
 *
 *   encryptedPayload = JSON { v: 1, keyVersion, key, data }
 *     dek  = generateFileKey()                    fresh per write
 *     key  = encryptFileKey(dek, activePublicKey) crypto_box_seal, base64url no padding
 *     data = encryptMetadata(payload, dek)        one secretstream push, base64url no padding
 *   payload = { name, lat, lng, radiusM }
 *
 * A reader rejects any `v` but 1 and ignores payload fields it doesn't know. It opens with the
 * keypair for `keyVersion`, which may be a retired one after a rotation.
 *
 * This is a wire format shared with iOS (`PlaceEnvelope` in `NeutrinoCrypto`, neutrino_shared_ios)
 * and pinned by `place_envelope_vectors.json`, which that package generates from this one.
 * Change it in every client at once. See `agent_docs/end-to-end-encryption.md`.
 */

import { decryptFileKey, decryptMetadata, encryptFileKey, encryptMetadata, generateFileKey } from './crypto';

export const PLACE_ENVELOPE_VERSION = 1;

/** What a saved place holds. Everything here is encrypted. */
export interface PlacePayload {
  name: string;
  lat: number;
  lng: number;
  /** The arrival radius in metres. */
  radiusM: number;
}

/** `unsupportedVersion`: an envelope from a newer client. `malformed`: not an envelope at all. */
export type PlaceEnvelopeErrorCode = 'unsupportedVersion' | 'malformed';

export class PlaceEnvelopeError extends Error {
  constructor(readonly code: PlaceEnvelopeErrorCode, message: string) {
    super(message);
    this.name = 'PlaceEnvelopeError';
  }
}

interface Envelope {
  v: number;
  keyVersion: number;
  key: string;
  data: string;
}

function parseEnvelope(encryptedPayload: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encryptedPayload);
  } catch {
    throw new PlaceEnvelopeError('malformed', 'Saved place is not an envelope');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new PlaceEnvelopeError('malformed', 'Saved place is not an envelope');
  }
  const e = parsed as Record<string, unknown>;
  if (typeof e.v !== 'number') {
    throw new PlaceEnvelopeError('malformed', 'Saved place has no envelope version');
  }
  if (e.v !== PLACE_ENVELOPE_VERSION) {
    throw new PlaceEnvelopeError('unsupportedVersion', `Saved place envelope v${e.v} is not supported`);
  }
  if (!Number.isInteger(e.keyVersion) || typeof e.key !== 'string' || typeof e.data !== 'string') {
    throw new PlaceEnvelopeError('malformed', 'Saved place envelope is incomplete');
  }
  return e as unknown as Envelope;
}

/** Seals `payload` to the account's active key, recording which version that was. */
export function sealPlace(payload: PlacePayload, publicKey: Uint8Array, keyVersion: number): string {
  const dek = generateFileKey();
  const envelope: Envelope = {
    v: PLACE_ENVELOPE_VERSION,
    keyVersion,
    key: encryptFileKey(dek, publicKey),
    // Only the known fields, in a fixed order, whatever else the caller's object carries.
    data: encryptMetadata(
      { name: payload.name, lat: payload.lat, lng: payload.lng, radiusM: payload.radiusM },
      dek,
    ),
  };
  return JSON.stringify(envelope);
}

/** The key version an envelope was sealed to, to pick the keypair that opens it. */
export function placeKeyVersion(encryptedPayload: string): number {
  return parseEnvelope(encryptedPayload).keyVersion;
}

/**
 * Opens an envelope with the keypair for its `keyVersion`. Throws `PlaceEnvelopeError` for a
 * format it can't read, and the underlying decrypt error for the wrong key or altered data.
 */
export function openPlace(encryptedPayload: string, publicKey: Uint8Array, secretKey: Uint8Array): PlacePayload {
  const envelope = parseEnvelope(encryptedPayload);
  const dek = decryptFileKey(envelope.key, publicKey, secretKey);
  const p = decryptMetadata(envelope.data, dek);
  if (
    typeof p.name !== 'string' ||
    typeof p.lat !== 'number' ||
    typeof p.lng !== 'number' ||
    typeof p.radiusM !== 'number'
  ) {
    throw new PlaceEnvelopeError('malformed', 'Saved place payload is incomplete');
  }
  return { name: p.name, lat: p.lat, lng: p.lng, radiusM: p.radiusM };
}
