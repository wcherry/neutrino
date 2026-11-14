// @vitest-environment node
/** The link key (#321): a seed in the URL fragment that stands for an X25519 keypair. */

import { describe, it, expect, beforeAll } from 'vitest';
import { initSodium, encryptFileKey, generateFileKey } from '../crypto';
import { fromBase64url } from '../keystore';
import {
  generateLinkSeed,
  linkFragment,
  linkKeyPairFromSeed,
  linkPublicKey,
  openLinkFileKey,
  seedFromFragment,
} from '../linkKey';

beforeAll(async () => {
  await initSodium();
});

describe('link key', () => {
  it('derives the same keypair from the same seed', async () => {
    const seed = await generateLinkSeed();
    const a = await linkKeyPairFromSeed(seed);
    const b = await linkKeyPairFromSeed(seed);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.secretKey).toEqual(b.secretKey);
    expect(await linkPublicKey(seed)).toHaveLength(43);
  });

  it('opens a DEK sealed to the link public key with ordinary crypto_box_seal', async () => {
    const seed = await generateLinkSeed();
    const dek = generateFileKey();
    const sealed = encryptFileKey(dek, fromBase64url(await linkPublicKey(seed)));
    expect(await openLinkFileKey(seed, sealed)).toEqual(dek);
  });

  it('does not open with another link', async () => {
    const sealed = encryptFileKey(
      generateFileKey(),
      fromBase64url(await linkPublicKey(await generateLinkSeed())),
    );
    await expect(openLinkFileKey(await generateLinkSeed(), sealed)).rejects.toThrow();
  });

  it('round-trips through a URL fragment and rejects anything else', async () => {
    const seed = await generateLinkSeed();
    expect(seedFromFragment(linkFragment(seed))).toBe(seed);
    expect(seedFromFragment(`k=${seed}`)).toBe(seed);
    expect(seedFromFragment('')).toBeNull();
    expect(seedFromFragment('#k=short')).toBeNull();
    await expect(linkKeyPairFromSeed('AAAA')).rejects.toThrow();
  });
});
