'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  permissionsApi,
  sharingApi,
  usersApi,
  authApi,
  encryptionApi,
  type FileItem,
  type Folder as FolderItem,
  type PermissionRole,
  type ResourceType,
} from '@/lib/api';
import {
  initSodium,
  loadKeyPair,
  openSealedFileKey,
  encryptFileKey,
  fromBase64url,
  checkKey,
  pinKey,
  fingerprintFor,
} from '@neutrino/e2e-crypto';
import { useUser } from '@neutrino/auth';
import { useToast } from '@neutrino/ui';
import { ShareDialog as ShareDialogUI } from '@neutrino/ui';
import type { SharePermission, SharePermissionRole } from '@neutrino/ui';
import { KeyChangeDialog } from '@/components/KeyChangeDialog';

interface Props {
  resource: FileItem | FolderItem;
  resourceType: ResourceType;
  onClose: () => void;
}

export function ShareDialog({ resource, resourceType, onClose }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const currentUser = useUser();

  const permsKey = ['permissions', resourceType, resource.id];
  const linkKey = ['share-link', resourceType, resource.id];

  const { data: permsData, isLoading: permsLoading } = useQuery({
    queryKey: permsKey,
    queryFn: () => permissionsApi.listPermissions(resourceType, resource.id),
    retry: false,
  });

  const { data: shareLink, isLoading: linkLoading } = useQuery({
    queryKey: linkKey,
    queryFn: () => sharingApi.getShareLink(resourceType, resource.id),
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: PermissionRole }) =>
      permissionsApi.updatePermission(resourceType, resource.id, userId, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: permsKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) =>
      permissionsApi.revokePermission(resourceType, resource.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permsKey });
      toast.success('Access removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createLinkMutation = useMutation({
    mutationFn: () =>
      sharingApi.upsertShareLink(resourceType, resource.id, {
        visibility: 'anyoneWithLink',
        role: 'viewer',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleLinkMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      sharingApi.updateShareLink(resourceType, resource.id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLinkRoleMutation = useMutation({
    mutationFn: (role: string) =>
      sharingApi.updateShareLink(resourceType, resource.id, { role: role as 'viewer' | 'commenter' | 'editor' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLinkVisibilityMutation = useMutation({
    mutationFn: (visibility: 'public' | 'anyoneWithLink') =>
      sharingApi.updateShareLink(resourceType, resource.id, { visibility }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLinkExpiryMutation = useMutation({
    mutationFn: (expiresAt: string | null) =>
      sharingApi.updateShareLink(resourceType, resource.id, { expiresAt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteLinkMutation = useMutation({
    mutationFn: () => sharingApi.deleteShareLink(resourceType, resource.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Recipient key verification ─────────────────────────────────────────────
  //
  // The public key we seal a DEK to comes from the server, unsigned and bound to
  // nothing. `checkKey` compares it against what this browser pinned the first
  // time it sealed to this person; a mismatch stops the share until a human has
  // confirmed the new key out of band. See `packages/e2e-crypto/src/pinning.ts`.

  const [keyChange, setKeyChange] = React.useState<{
    recipientLabel: string;
    previousFingerprint: string;
    offeredFingerprint: string;
    firstSeen: string;
    wasVerified: boolean;
  } | null>(null);

  // Resolver for the promise `shareE2EKey` parks on while the dialog is open.
  const keyDecisionRef = React.useRef<((trust: boolean) => void) | null>(null);

  function resolveKeyChange(trust: boolean): void {
    const resolve = keyDecisionRef.current;
    keyDecisionRef.current = null;
    setKeyChange(null);
    resolve?.(trust);
  }

  type ShareKeyOutcome =
    /** DEK sealed to a trusted key and stored. */
    | 'shared'
    /** Nothing to share — one side has no key, so the file is plaintext. */
    | 'skipped'
    /** The recipient's key changed and the user would not vouch for the new one. */
    | 'declined';

  async function shareE2EKey(
    fileId: string,
    recipientId: string,
    recipientLabel: string,
  ): Promise<ShareKeyOutcome> {
    const userId = currentUser?.id;
    if (!userId) return 'skipped';

    await initSodium();
    const kp = loadKeyPair(userId);
    if (!kp) return 'skipped'; // no local keypair — file is plaintext

    const keyRef = await encryptionApi.getFileKey(fileId);
    if (!keyRef) return 'skipped'; // file has no DEK — plaintext file

    const recipientKeyResp = await authApi.getUserPublicKey(recipientId);
    if (!recipientKeyResp) return 'skipped'; // recipient has no public key yet

    const offered = recipientKeyResp.publicKey;
    const check = checkKey(userId, recipientId, offered);

    if (check.status === 'changed') {
      const trusted = await new Promise<boolean>((resolve) => {
        keyDecisionRef.current = resolve;
        setKeyChange({
          recipientLabel,
          previousFingerprint: fingerprintFor(recipientId, check.pinned.publicKey),
          offeredFingerprint: fingerprintFor(recipientId, offered),
          firstSeen: check.pinned.firstSeen,
          wasVerified: check.pinned.verifiedAt !== null,
        });
      });
      if (!trusted) return 'declined';
      // Reaching here means the user compared fingerprints out of band, so the
      // replacement pin is recorded as verified rather than merely seen.
      pinKey(userId, recipientId, offered, true);
    } else if (check.status === 'unpinned') {
      pinKey(userId, recipientId, offered);
    }

    // Decrypt only once the key is settled — no reason to hold a plaintext DEK
    // in memory while a modal waits on a human. Opening uses *our* key version,
    // the one this file was sealed to; re-sealing uses the *recipient's* current
    // version, which is what they will resolve it against.
    const dek = openSealedFileKey(userId, keyRef.encryptedFileKey, keyRef.keyVersion);
    const encryptedFileKey = encryptFileKey(dek, fromBase64url(offered));

    await encryptionApi.shareFileKey(fileId, {
      recipientId,
      encryptedFileKey,
      keyVersion: recipientKeyResp.version,
    });
    return 'shared';
  }

  async function handleAddPerson(email: string, role: SharePermissionRole): Promise<void> {
    const user = await usersApi.lookupByEmail(email);
    if (!user) {
      throw new Error('No user found with that email address');
    }
    await permissionsApi.grantPermission(resourceType, resource.id, {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      role: role as PermissionRole,
    });

    // For files only: share the encrypted DEK with the recipient.
    // A thrown error here is still non-fatal — if either party has no keypair
    // the file is plaintext and there is nothing to hand over.
    if (resourceType === 'file') {
      const label = user.name || user.email;
      const outcome = await shareE2EKey(resource.id, user.id, label).catch((err) => {
        console.warn('E2E key share failed (non-fatal):', err);
        return 'skipped' as const;
      });

      // The permission grant already landed, so a declined key leaves the
      // recipient able to see the file listed but not to open it. Say so rather
      // than reporting a clean success — and leave the grant in place, since
      // removing access is one click away in this same dialog.
      if (outcome === 'declined') {
        toast.error(
          `${label} was given access, but the file key was not shared because their ` +
            'encryption key could not be verified. They will not be able to open this file.',
        );
      }
    }

    queryClient.invalidateQueries({ queryKey: permsKey });
  }

  // Map API Permission objects to UI SharePermission shape
  const permissions: SharePermission[] = (permsData?.permissions ?? []).map((p) => ({
    id: p.id,
    userId: p.userId,
    role: p.role as SharePermissionRole,
    userName: p.userName ?? null,
    userEmail: p.userEmail ?? null,
  }));

  return (
    <>
      {keyChange && (
        <KeyChangeDialog
          recipientLabel={keyChange.recipientLabel}
          previousFingerprint={keyChange.previousFingerprint}
          offeredFingerprint={keyChange.offeredFingerprint}
          firstSeen={keyChange.firstSeen}
          wasVerified={keyChange.wasVerified}
          onTrust={() => resolveKeyChange(true)}
          onCancel={() => resolveKeyChange(false)}
        />
      )}
      <ShareDialogUI
        resourceName={resource.name}
        permissions={permissions}
        permissionsLoading={permsLoading}
        shareLink={shareLink ?? null}
        shareLinkLoading={linkLoading}
        permissionsPending={updateMutation.isPending || revokeMutation.isPending}
        linkPending={
          toggleLinkMutation.isPending ||
          updateLinkRoleMutation.isPending ||
          updateLinkVisibilityMutation.isPending ||
          updateLinkExpiryMutation.isPending ||
          deleteLinkMutation.isPending
        }
        createLinkPending={createLinkMutation.isPending}
        onClose={onClose}
        onAddPerson={handleAddPerson}
        onSearchUsers={async (query) => {
          const results = await usersApi.searchUsers(query);
          return results.map((u) => ({ id: u.id, email: u.email, name: u.name }));
        }}
        onRoleChange={(userId, role) =>
          updateMutation.mutate({ userId, role: role as PermissionRole })
        }
        onRevoke={(userId) => revokeMutation.mutate(userId)}
        onCreateLink={() => createLinkMutation.mutate()}
        onToggleLink={(isActive) => toggleLinkMutation.mutate(isActive)}
        onLinkRoleChange={(role) => updateLinkRoleMutation.mutate(role)}
        onLinkVisibilityChange={(visibility) => updateLinkVisibilityMutation.mutate(visibility)}
        onLinkExpiryChange={(expiresAt) => updateLinkExpiryMutation.mutate(expiresAt)}
        onDeleteLink={() => deleteLinkMutation.mutate()}
      />
    </>
  );
}
