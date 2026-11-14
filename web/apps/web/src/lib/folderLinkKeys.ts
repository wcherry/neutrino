/**
 * The owner's side of a folder link's key (#321).
 *
 * A folder link carries a seed in its URL fragment that stands for a keypair; files in the folder
 * are sealed to the public half. The server keeps the public key, and the seed only **sealed to the
 * owner's own public key** — so the owner's browser can rebuild the full URL to copy it again,
 * while the server, which never sees a fragment, still cannot open a single file.
 */

import {
  activeKeyVersion,
  encryptFileKey,
  fromBase64url,
  generateLinkSeed,
  initSodium,
  linkFragment,
  linkPublicKey,
  loadKeyPair,
  openSealedFileKey,
  toBase64url,
} from '@neutrino/e2e-crypto';
import type { ShareLink } from '@/lib/api';

export interface NewLinkKey {
  seed: string;
  publicKey: string;
  sealedSeed: string;
  sealedSeedKeyVersion: number;
}

/** Mint a link key for the signed-in owner. Null when their keyring is locked or absent. */
export async function makeLinkKey(userId: string | undefined): Promise<NewLinkKey | null> {
  if (!userId) return null;
  await initSodium();
  const kp = loadKeyPair(userId);
  const version = activeKeyVersion(userId);
  if (!kp || version === null) return null;
  const seed = await generateLinkSeed();
  return {
    seed,
    publicKey: await linkPublicKey(seed),
    sealedSeed: encryptFileKey(fromBase64url(seed), kp.publicKey),
    sealedSeedKeyVersion: version,
  };
}

/**
 * The seed behind a link, opened with the owner's keyring, and checked against the link's public
 * key. Null when this browser cannot open it (locked, or the key version is not here) or when it
 * does not match — copying a URL whose key opens nothing would be worse than not copying.
 */
export async function recoverLinkSeed(
  userId: string | undefined,
  link: Pick<ShareLink, 'sealedSeed' | 'sealedSeedKeyVersion' | 'publicKey'>,
): Promise<string | null> {
  if (!userId || !link.sealedSeed || !link.publicKey) return null;
  try {
    await initSodium();
    const seed = toBase64url(
      openSealedFileKey(userId, link.sealedSeed, link.sealedSeedKeyVersion ?? 1),
    );
    return (await linkPublicKey(seed)) === link.publicKey ? seed : null;
  } catch {
    return null;
  }
}

/** The full link: token in the query, key in the fragment the server never receives. */
export function folderLinkUrl(origin: string, token: string, seed: string): string {
  return `${origin}/share?token=${token}${linkFragment(seed)}`;
}
