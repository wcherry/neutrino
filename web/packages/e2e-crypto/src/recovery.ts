'use client';

/**
 * Recovery codes — the unlock method of last resort.
 *
 * If someone forgets their password and loses every enrolled passkey, there is
 * no reset: the server has never held anything that opens the vault. The
 * recovery code is the only remaining wrapped copy of the master key, which is
 * why enrolment generates one unconditionally and shows it once.
 *
 * Crockford base32 alphabet — no I, L, O or U, so the code survives being read
 * aloud or copied off paper. 24 characters is 120 bits, far beyond what any
 * offline grind reaches, so it needs no memorability compromise.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 24;
const GROUP_SIZE = 4;

/**
 * Generate a formatted recovery code, e.g. `4K7M-9PQR-2TVW-XYZ0-1234-5678`.
 *
 * 256 happens to be a multiple of the current 32-character alphabet, so `% 32`
 * would be unbiased today. The rejection sampling is there so that stays true
 * if the alphabet ever changes length — silent modulo bias in a recovery code
 * is not a failure anyone would notice.
 */
export function generateRecoveryCode(): string {
  const chars: string[] = [];
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  const buf = new Uint8Array(1);

  while (chars.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    chars.push(ALPHABET[buf[0] % ALPHABET.length]);
  }

  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GROUP_SIZE) {
    groups.push(chars.slice(i, i + GROUP_SIZE).join(''));
  }
  return groups.join('-');
}

/**
 * Canonicalise a user-typed code before derivation.
 *
 * Strips separators and whitespace, uppercases, and folds the characters
 * Crockford excludes onto their lookalikes — so a code transcribed with `O` for
 * zero or `l` for one still unlocks.
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

/** True if `input` could be a recovery code — used to pick the unlock method. */
export function looksLikeRecoveryCode(input: string): boolean {
  const normalized = normalizeRecoveryCode(input);
  return (
    normalized.length === CODE_LENGTH &&
    [...normalized].every((c) => ALPHABET.includes(c))
  );
}
