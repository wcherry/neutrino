/**
 * The key a folder link carries (#321).
 *
 * Someone opening a share link has no account and so no keypair, yet Drive files are sealed per
 * recipient. A folder link is therefore a recipient of its own: the owner's browser makes a
 * 32-byte **seed**, puts it in the link's URL fragment (`#k=<base64url>`, which browsers never send
 * to a server), derives an X25519 keypair from it with `crypto_box_seed_keypair`, and uploads only
 * the public half. Every file's DEK in the folder is then sealed to that public key with the same
 * `crypto_box_seal` every other recipient gets, so a native client sealing a new upload to a link
 * needs nothing beyond what it already does — the seed and this derivation are only ever used by
 * whoever *opens* the link, which in v1 is the web.
 */

import { decryptFileKey, initSodium, toBase64url, type KeyPair } from './crypto';
import { fromBase64url } from './keystore';
import { sodium } from './sodium';

export const LINK_SEED_BYTES = 32;

/** The fragment parameter the seed travels in. */
export const LINK_FRAGMENT_PARAM = 'k';

/** A fresh link seed, base64url without padding. */
export async function generateLinkSeed(): Promise<string> {
  await initSodium();
  return toBase64url(sodium.randombytes_buf(LINK_SEED_BYTES));
}

/** The keypair a link seed stands for. Throws on a seed that is not 32 bytes. */
export async function linkKeyPairFromSeed(seed: string): Promise<KeyPair> {
  await initSodium();
  const bytes = fromBase64url(seed);
  if (bytes.length !== LINK_SEED_BYTES) {
    throw new Error('A link key must be 32 bytes');
  }
  const kp = sodium.crypto_box_seed_keypair(bytes);
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/** The base64url public key to store on the server for a seed. */
export async function linkPublicKey(seed: string): Promise<string> {
  return toBase64url((await linkKeyPairFromSeed(seed)).publicKey);
}

/** Open a DEK sealed to a link. */
export async function openLinkFileKey(seed: string, encryptedFileKey: string): Promise<Uint8Array> {
  const kp = await linkKeyPairFromSeed(seed);
  return decryptFileKey(encryptedFileKey, kp.publicKey, kp.secretKey);
}

/** `#k=<seed>` for a link URL. */
export function linkFragment(seed: string): string {
  return `#${LINK_FRAGMENT_PARAM}=${seed}`;
}

/** The seed in a URL fragment (`#k=…`, with or without the `#`), or null when there is none. */
export function seedFromFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const seed = params.get(LINK_FRAGMENT_PARAM);
  return seed && /^[A-Za-z0-9_-]{43}$/.test(seed) ? seed : null;
}
