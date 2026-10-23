/**
 * Preference-vault envelope (v1): the sealed half of a user's synced preferences
 * (`user_preference_vault.blob`, agent_docs/ui-customization-roadmap.md §3.2) —
 * the AI API key and personal libraries, which the server stores and must not read.
 *
 * Built from exactly the primitives a saved place uses (`place.ts`), so it is no new
 * cryptography:
 *
 *   blob     = base64url(JSON { v: 1, keyVersion, key, data })
 *     dek    = generateFileKey()                     fresh per write
 *     key    = encryptFileKey(dek, activePublicKey)  crypto_box_seal, base64url
 *     data   = encryptMetadata(payload, dek)         one secretstream push, base64url
 *   payload  = { [registry key]: value }
 *
 * The outer base64url is only so the server can check the blob is one opaque token
 * (it refuses anything else); the envelope inside is the place envelope's shape.
 *
 * **Web-only for now.** No native client reads preferences yet, so unlike the place
 * envelope this one is not pinned by cross-client vectors. A native reader would need
 * this exact construction — treat it as a wire format from the day one exists.
 */

import { decryptFileKey, decryptMetadata, encryptFileKey, encryptMetadata, generateFileKey } from './crypto';

export const PREFERENCE_VAULT_VERSION = 1;

export class PreferenceVaultError extends Error {
  constructor(readonly code: 'unsupportedVersion' | 'malformed', message: string) {
    super(message);
    this.name = 'PreferenceVaultError';
  }
}

interface Envelope {
  v: number;
  keyVersion: number;
  key: string;
  data: string;
}

function toB64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function parse(blob: string): Envelope {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(fromB64url(blob));
  } catch {
    throw new PreferenceVaultError('malformed', 'Preference vault is not an envelope');
  }
  if (typeof e !== 'object' || e === null || typeof e.v !== 'number') {
    throw new PreferenceVaultError('malformed', 'Preference vault has no envelope version');
  }
  if (e.v !== PREFERENCE_VAULT_VERSION) {
    throw new PreferenceVaultError('unsupportedVersion', `Preference vault v${e.v} is not supported`);
  }
  if (!Number.isInteger(e.keyVersion) || typeof e.key !== 'string' || typeof e.data !== 'string') {
    throw new PreferenceVaultError('malformed', 'Preference vault envelope is incomplete');
  }
  return e as unknown as Envelope;
}

/** Seals `payload` to the account's active key, recording which version that was. */
export function sealPreferenceVault(
  payload: Record<string, unknown>,
  publicKey: Uint8Array,
  keyVersion: number,
): string {
  const dek = generateFileKey();
  const envelope: Envelope = {
    v: PREFERENCE_VAULT_VERSION,
    keyVersion,
    key: encryptFileKey(dek, publicKey),
    data: encryptMetadata(payload, dek),
  };
  return toB64url(JSON.stringify(envelope));
}

/** The key version a vault was sealed to, to pick the keypair that opens it. */
export function preferenceVaultKeyVersion(blob: string): number {
  return parse(blob).keyVersion;
}

/**
 * Opens a vault with the keypair for its `keyVersion`. Throws `PreferenceVaultError` for a
 * format it can't read, and the underlying decrypt error for the wrong key or altered data.
 */
export function openPreferenceVault(
  blob: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Record<string, unknown> {
  const envelope = parse(blob);
  const dek = decryptFileKey(envelope.key, publicKey, secretKey);
  return decryptMetadata(envelope.data, dek);
}
