'use client';

/**
 * WebAuthn PRF — using a passkey as a key-derivation oracle.
 *
 * A passkey is a *signing* credential, so the tempting shortcut of "sign a
 * fixed challenge and hash the signature" does not work: WebAuthn signs over
 * `authenticatorData`, which carries a counter that changes on every assertion,
 * and ES256 is randomised anyway. You would get different bytes every time.
 *
 * The `prf` extension (CTAP2's `hmac-secret`) exists for exactly this. The
 * authenticator holds a per-credential secret, and returns HMAC(secret, salt)
 * — deterministic for a given salt, never extractable, and released only after
 * a user gesture. Those 32 bytes are the key-encryption key for the vault's
 * master key.
 *
 * Note that nothing here is authentication: the user already holds a valid JWT,
 * and the PRF output never leaves the browser. So the ceremony challenges below
 * are random client-side bytes and no assertion is verified server-side —
 * forging a credential ID gains an attacker nothing, because they still cannot
 * produce the PRF output that opens the blob.
 */

import sodium from 'libsodium-wrappers';

/** Serialised into `user_key_unlocks.params` for passkey methods. */
export interface PasskeyParams {
  kdf: 'webauthn-prf';
  /** base64url credential ID, used to target this exact passkey at unlock. */
  credentialId: string;
  /** base64url, 32 bytes — the PRF input. Random per credential. */
  prfSalt: string;
}

// The `prf` extension is newer than the bundled DOM typings, so the ceremony
// inputs and results are described locally and cast at the call sites.
interface PrfExtensionInput {
  prf?: { eval?: { first: BufferSource; second?: BufferSource } };
}
interface PrfExtensionOutput {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer; second?: ArrayBuffer } };
}

const PRF_SALT_BYTES = 32;
const CHALLENGE_BYTES = 32;

function b64u(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function unb64u(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * `Uint8Array` is a valid `BufferSource` at runtime, but since TypeScript 5.7
 * the former is generic over its backing buffer and no longer assignable to the
 * latter. Same cast the PIN-export path in `crypto.ts` uses.
 */
function buf(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** True when the browser exposes WebAuthn at all. PRF support itself can only
 *  be confirmed by attempting a ceremony — authenticators disagree. */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator?.credentials?.create === 'function'
  );
}

function readPrfResult(credential: PublicKeyCredential): Uint8Array | null {
  const results = (credential.getClientExtensionResults() as PrfExtensionOutput).prf?.results;
  if (!results?.first) return null;
  return new Uint8Array(results.first);
}

/**
 * Create a passkey and return its PRF output.
 *
 * Many authenticators do not return PRF results from the registration ceremony
 * even when they support the extension, so this always follows `create()` with
 * an immediate `get()` to read the value. That costs a second user gesture at
 * enrolment only.
 */
export async function registerPasskey(
  userId: string,
  userName: string,
  label: string,
): Promise<{ params: PasskeyParams; prfOutput: Uint8Array }> {
  if (!isPasskeySupported()) {
    throw new Error('This browser does not support passkeys');
  }

  const prfSalt = randomBytes(PRF_SALT_BYTES);

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: buf(randomBytes(CHALLENGE_BYTES)),
      rp: { name: 'Neutrino' },
      user: {
        id: buf(new TextEncoder().encode(userId)),
        name: userName,
        displayName: label || userName,
      },
      // ES256 then RS256 — the two every authenticator implements.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        // The gesture is the point: it is what gates access to the key.
        userVerification: 'required',
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as PrfExtensionInput,
    },
  })) as PublicKeyCredential | null;

  if (!created) {
    throw new Error('Passkey creation was cancelled');
  }

  const extensions = created.getClientExtensionResults() as PrfExtensionOutput;
  if (extensions.prf?.enabled === false) {
    throw new Error(
      'This passkey does not support PRF, which is required to protect your encryption key. ' +
        'Try a different passkey provider, or use a password instead.',
    );
  }

  const params: PasskeyParams = {
    kdf: 'webauthn-prf',
    credentialId: b64u(new Uint8Array(created.rawId)),
    prfSalt: b64u(prfSalt),
  };

  // Registration-time results are optional; read them if present, else assert.
  const prfOutput = readPrfResult(created) ?? (await getPasskeyPrf(params));
  return { params, prfOutput };
}

/**
 * Prompt for the passkey named by `params` and return its 32-byte PRF output.
 */
export async function getPasskeyPrf(params: PasskeyParams): Promise<Uint8Array> {
  if (!isPasskeySupported()) {
    throw new Error('This browser does not support passkeys');
  }
  if (params.kdf !== 'webauthn-prf') {
    throw new Error(`Unsupported passkey derivation: ${String(params.kdf)}`);
  }

  const prfSalt = unb64u(params.prfSalt);
  const credentialId = unb64u(params.credentialId);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(randomBytes(CHALLENGE_BYTES)),
      allowCredentials: [{ type: 'public-key', id: buf(credentialId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as PrfExtensionInput,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error('Passkey unlock was cancelled');
  }

  const prfOutput = readPrfResult(assertion);
  if (!prfOutput) {
    throw new Error(
      'Your passkey provider did not return a PRF value. ' +
        'Unlock with your password or recovery code instead.',
    );
  }
  return prfOutput;
}
