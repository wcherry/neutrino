/**
 * One Drive file's bytes, decrypted when the session can.
 *
 * Shared by everything that plays a motion clip — the Photos library's tiles
 * (`MotionPhotoMedia`) and Drive's Live Photo hold (`lib/livePhotos/`). Photos
 * are E2EE, so `contentUrl` serves ciphertext and a `<video>` pointed straight
 * at it downloads the bytes and then plays nothing, with no error anywhere. The
 * bytes have to be unsealed here and handed over as an object URL.
 *
 * A file with no key on the server was stored before E2EE (or by a session that
 * had none) and is used as it arrives. `unlocked` false means the session has
 * no key pair yet; the ciphertext is returned and the caller's parse of it fails
 * as it would have, rather than this throwing a different error.
 */

import { storageApi, encryptionApi, openFileKey } from '@neutrino/api-drive';
import { initSodium, decryptFile } from '@neutrino/e2e-crypto';

export async function loadPlainBlob(fileId: string, userId: string, unlocked: boolean): Promise<Blob> {
  const downloaded = await storageApi.downloadFile(fileId);
  if (!unlocked) return downloaded;

  await initSodium();
  const keyRef = await encryptionApi.getFileKey(fileId);
  // No key on the server means the file was stored in the clear.
  if (!keyRef) return downloaded;

  const dek = await openFileKey(userId, fileId, keyRef);
  const plain = decryptFile(new Uint8Array(await downloaded.arrayBuffer()), dek);
  return new Blob([plain.buffer as ArrayBuffer]);
}
