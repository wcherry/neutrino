'use client';

/**
 * E2EE key lifecycle helpers.
 *
 * Call `ensureE2EKeys(userId)` after every successful login or registration.
 * It generates a keypair if none exists locally, then ensures the public key
 * is registered with the server.
 */

import {
  initSodium,
  generateKeyPair,
  loadKeyPair,
  saveKeyPair,
  hasKeyPair,
  toBase64url,
} from '@neutrino/e2e-crypto';
import { authApi } from './client';

/**
 * Ensure the user has a Curve25519 keypair stored locally, and that the
 * public key is registered with the server.
 *
 * - If a keypair already exists locally: verify the public key is on the
 *   server (upload it if it's missing).
 * - If no keypair exists: generate one, save it, and upload the public key.
 */
export async function ensureE2EKeys(userId: string): Promise<void> {
  await initSodium();

  if (!hasKeyPair(userId)) {
    const { publicKey, secretKey } = generateKeyPair();
    saveKeyPair(userId, publicKey, secretKey);
    await authApi.setPublicKey({ publicKey: toBase64url(publicKey) });
    return;
  }

  // Keypair exists locally — make sure the server has the public key.
  const existing = await authApi.getUserPublicKey(userId);
  if (!existing) {
    const kp = loadKeyPair(userId);
    if (kp) {
      await authApi.setPublicKey({ publicKey: toBase64url(kp.publicKey) });
    }
  }
}
