/**
 * Answering a request for a team file's key (UI roadmap stage 6).
 *
 * Someone who joins a team after a file was added to it can see the file and cannot open it: its
 * key was sealed to the members of the day (`teamTransfer.ts`), and the server never holds the
 * plaintext key, so it cannot add a new one. The member asks (`teamsApi.requestFileKey`); a team
 * Owner or Admin, or the file's owner, answers here — sealing the key to the requester in this
 * browser and then approving, in that order: the server refuses an approval until the requester
 * holds a key (`KEY_NOT_SHARED`), so an approved request always means a file they can open.
 *
 * The same care as a bulk handover: a requester whose public key is not the one this browser pinned
 * is not sealed to — the approver is sent to the file's Share dialog, where fingerprints can be
 * compared.
 */

import {
  initSodium,
  loadKeyPair,
  encryptFileKey,
  fromBase64url,
  checkKey,
  pinKey,
} from '@neutrino/e2e-crypto';
import { authApi, encryptionApi, openFileKey, teamsApi, type TeamKeyRequest } from '@/lib/api';

export type KeyApproval =
  /** Sealed and approved. */
  | 'approved'
  /** This browser cannot open the file's key: no keypair here, or the approver has none either. */
  | 'no-key-here'
  /** The requester has not set up encryption, so there is nothing to seal to. */
  | 'requester-has-no-key'
  /** The requester's public key changed since this browser last sealed to them. */
  | 'unverified';

/** Seal the file's key to the requester, then approve. Throws only on a failed request. */
export async function approveKeyRequest(
  request: TeamKeyRequest,
  currentUserId: string | undefined
): Promise<KeyApproval> {
  if (!currentUserId) return 'no-key-here';
  await initSodium();
  if (!loadKeyPair(currentUserId)) return 'no-key-here';
  const keyRef = await encryptionApi.getFileKey(request.fileId);
  if (!keyRef) return 'no-key-here';

  const recipientKey = await authApi.getUserPublicKey(request.requesterId);
  if (!recipientKey) return 'requester-has-no-key';
  const offered = recipientKey.publicKey;
  const check = checkKey(currentUserId, request.requesterId, offered);
  if (check.status === 'changed') return 'unverified';
  if (check.status === 'unpinned') pinKey(currentUserId, request.requesterId, offered);

  const dek = await openFileKey(currentUserId, request.fileId, keyRef);
  await encryptionApi.shareFileKey(request.fileId, {
    recipientId: request.requesterId,
    encryptedFileKey: encryptFileKey(dek, fromBase64url(offered)),
    keyVersion: recipientKey.version,
  });
  await teamsApi.approveKeyRequest(request.teamId, request.id);
  return 'approved';
}

/** What to tell the approver when the key could not be handed over. */
export function describeKeyApproval(result: KeyApproval, requester: string): string {
  switch (result) {
    case 'approved':
      return `${requester} can now open the file.`;
    case 'no-key-here':
      return 'You do not have this file’s key on this device. Unlock your encryption key in Settings → Security, or ask someone who can open the file.';
    case 'requester-has-no-key':
      return `${requester} has not set up encryption yet, so there is no key to share with them.`;
    case 'unverified':
      return `${requester} has a new encryption key that has not been verified. Share the file with them from its Share dialog to compare fingerprints.`;
  }
}
