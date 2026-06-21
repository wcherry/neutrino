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
import { initSodium, loadKeyPair, decryptFileKey, encryptFileKey, fromBase64url } from '@neutrino/e2e-crypto';
import { useUser } from '@neutrino/auth';
import { useToast } from '@neutrino/ui';
import { ShareDialog as ShareDialogUI } from '@neutrino/ui';
import type { SharePermission, SharePermissionRole } from '@neutrino/ui';

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

  async function shareE2EKey(fileId: string, recipientId: string): Promise<void> {
    const userId = currentUser?.id;
    if (!userId) return;

    await initSodium();
    const kp = loadKeyPair(userId);
    if (!kp) return; // no local keypair — file is plaintext

    const keyRef = await encryptionApi.getFileKey(fileId);
    if (!keyRef) return; // file has no DEK — plaintext file

    const dek = decryptFileKey(keyRef.encryptedFileKey, kp.publicKey, kp.secretKey);

    const recipientKeyResp = await authApi.getUserPublicKey(recipientId);
    if (!recipientKeyResp) return; // recipient hasn't registered a public key yet

    const recipientPubKey = fromBase64url(recipientKeyResp.publicKey);
    const encryptedFileKey = encryptFileKey(dek, recipientPubKey);

    await encryptionApi.shareFileKey(fileId, { recipientId, encryptedFileKey });
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
    // Silent failure — if either party has no keypair the file is plaintext.
    if (resourceType === 'file') {
      await shareE2EKey(resource.id, user.id).catch((err) => {
        console.warn('E2E key share failed (non-fatal):', err);
      });
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
      onRoleChange={(userId, role) => updateMutation.mutate({ userId, role: role as PermissionRole })}
      onRevoke={(userId) => revokeMutation.mutate(userId)}
      onCreateLink={() => createLinkMutation.mutate()}
      onToggleLink={(isActive) => toggleLinkMutation.mutate(isActive)}
      onLinkRoleChange={(role) => updateLinkRoleMutation.mutate(role)}
      onLinkVisibilityChange={(visibility) => updateLinkVisibilityMutation.mutate(visibility)}
      onLinkExpiryChange={(expiresAt) => updateLinkExpiryMutation.mutate(expiresAt)}
      onDeleteLink={() => deleteLinkMutation.mutate()}
    />
  );
}
