/**
 * Answering a request for access to one of the caller's files or folders.
 *
 * Approving grants the role on the server, but an encrypted file's key is sealed per person and
 * the server never holds it in the clear — so, as for a team key request (`teamKeyRequests.ts`),
 * this browser seals the file's key to the requester too. The order is the other way round from a
 * key request: `POST /encryption/files/{id}/share` refuses a recipient who has no access yet
 * (`RECIPIENT_NO_ACCESS`), so the approval goes first and the key follows.
 *
 * A requester whose public key is not the one this browser pinned is not sealed to: the approver is
 * sent to the file's Share dialog, where fingerprints can be compared. A folder's contents carry
 * their own keys and are not resealed here.
 */

import {
  initSodium,
  loadKeyPair,
  encryptFileKey,
  fromBase64url,
  checkKey,
  pinKey,
} from '@neutrino/e2e-crypto';
import { accessRequestsApi, authApi, encryptionApi, openFileKey, type AccessRequest } from '@/lib/api';

export type AccessApproval =
  /** Approved, and the requester can open it: its key was sealed to them, or it has none. */
  | 'approved'
  /** Approved, but this browser cannot open the file's key to hand it over. */
  | 'approved-no-key-here'
  /** Approved, but the requester has not set up encryption, so there is nothing to seal to. */
  | 'approved-requester-has-no-key'
  /** Approved, but the requester's public key changed since this browser last sealed to them. */
  | 'approved-unverified'
  /** Approved; a folder, whose files keep their own keys. */
  | 'approved-folder';

/** Approve with the role they asked for, then seal the key. Throws only on a failed request. */
export async function approveAccessRequest(
  request: AccessRequest,
  currentUserId: string | undefined,
): Promise<AccessApproval> {
  await accessRequestsApi.approve(request.id, {
    requesterEmail: request.requesterEmail,
    requesterName: request.requesterName,
  });
  if (request.resourceType === 'folder') return 'approved-folder';
  if (!currentUserId) return 'approved-no-key-here';

  const keyRef = await encryptionApi.getFileKey(request.resourceId);
  // A plaintext file has no key: approving was the whole job.
  if (!keyRef) return 'approved';
  await initSodium();
  if (!loadKeyPair(currentUserId)) return 'approved-no-key-here';

  const recipientKey = await authApi.getUserPublicKey(request.requesterId);
  if (!recipientKey) return 'approved-requester-has-no-key';
  const offered = recipientKey.publicKey;
  const check = checkKey(currentUserId, request.requesterId, offered);
  if (check.status === 'changed') return 'approved-unverified';
  if (check.status === 'unpinned') pinKey(currentUserId, request.requesterId, offered);

  const dek = await openFileKey(currentUserId, request.resourceId, keyRef);
  await encryptionApi.shareFileKey(request.resourceId, {
    recipientId: request.requesterId,
    encryptedFileKey: encryptFileKey(dek, fromBase64url(offered)),
    keyVersion: recipientKey.version,
  });
  return 'approved';
}

/** What to tell the owner once a request is approved. */
export function describeAccessApproval(result: AccessApproval, requester: string): string {
  switch (result) {
    case 'approved':
      return `${requester} can now open it.`;
    case 'approved-folder':
      return `${requester} now has access to the folder.`;
    case 'approved-no-key-here':
      return `${requester} has access, but this device doesn’t have the file’s key to share. Open the file’s Share dialog on a device that can open it.`;
    case 'approved-requester-has-no-key':
      return `${requester} has access, but hasn’t set up encryption yet, so they can’t open the file until they do and you share it again.`;
    case 'approved-unverified':
      return `${requester} has access, but has a new encryption key that hasn’t been verified. Share the file with them from its Share dialog to compare fingerprints.`;
  }
}
