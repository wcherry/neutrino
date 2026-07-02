'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heading,
  Text,
  Button,
  EmptyState,
  useToast,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@neutrino/ui';
import { Trash2, Folder, RotateCcw } from 'lucide-react';
import { filesystemApi, type TrashFileItem, type TrashFolderItem } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import styles from './page.module.css';

interface PendingDelete {
  id: string;
  name: string;
  kind: 'file' | 'folder';
}

export default function TrashPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => filesystemApi.listTrash(),
  });

  const { mutate: emptyTrash, isPending: isEmptyingTrash } = useMutation({
    mutationFn: () => filesystemApi.emptyTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      toast.success('Trash emptied');
    },
    onError: () => toast.error('Failed to empty trash'),
  });

  const restoreFileMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.restoreFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      toast.success('File restored');
    },
    onError: () => toast.error('Failed to restore file'),
  });

  const restoreFolderMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.restoreFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      toast.success('Folder restored');
    },
    onError: () => toast.error('Failed to restore folder'),
  });

  const deleteFilePermanentlyMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.deleteFilePermanently(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setPendingDelete(null);
      toast.success('File permanently deleted');
    },
    onError: () => toast.error('Failed to delete file'),
  });

  const deleteFolderPermanentlyMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.deleteFolderPermanently(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setPendingDelete(null);
      toast.success('Folder permanently deleted');
    },
    onError: () => toast.error('Failed to delete folder'),
  });

  function confirmPermanentDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'file') {
      deleteFilePermanentlyMutation.mutate(pendingDelete.id);
    } else {
      deleteFolderPermanentlyMutation.mutate(pendingDelete.id);
    }
  }

  const isConfirmPending =
    deleteFilePermanentlyMutation.isPending || deleteFolderPermanentlyMutation.isPending;

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const isEmpty = !isLoading && files.length === 0 && folders.length === 0;

  if (isEmpty) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Heading level={1} size="xl">Trash</Heading>
        </div>
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          description="Files you delete will appear here for 30 days before being permanently removed."
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Trash</Heading>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => emptyTrash()}
          disabled={isEmptyingTrash}
        >
          Empty trash
        </Button>
      </div>

      <ul className={styles.list} role="list">
        {folders.map((folder: TrashFolderItem) => (
          <li key={folder.id} className={styles.item} aria-label={folder.name}>
            <div className={styles.itemIcon} style={{ color: 'var(--color-amber, #d97706)' }}>
              <Folder size={20} strokeWidth={1.5} />
            </div>
            <div className={styles.itemInfo}>
              <Text size="sm" weight="medium" truncate>{folder.name}</Text>
              <Text size="xs" color="muted">Deleted {formatDate(folder.deletedAt)}</Text>
            </div>
            <div className={styles.itemActions}>
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => restoreFolderMutation.mutate(folder.id)}
                disabled={restoreFolderMutation.isPending}
              >
                Restore
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingDelete({ id: folder.id, name: folder.name, kind: 'folder' })}
              >
                Delete forever
              </Button>
            </div>
          </li>
        ))}
        {files.map((file: TrashFileItem) => {
          const IconComponent = getFileIcon(file.mimeType);
          const iconColor = getIconColor(file.mimeType);
          return (
            <li key={file.id} className={styles.item} aria-label={file.name}>
              <div className={styles.itemIcon} style={{ color: iconColor }}>
                <IconComponent size={20} strokeWidth={1.5} />
              </div>
              <div className={styles.itemInfo}>
                <Text size="sm" weight="medium" truncate>{file.name}</Text>
                <Text size="xs" color="muted">Deleted {formatDate(file.deletedAt)}</Text>
              </div>
              <div className={styles.itemActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => restoreFileMutation.mutate(file.id)}
                  disabled={restoreFileMutation.isPending}
                >
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDelete({ id: file.id, name: file.name, kind: 'file' })}
                >
                  Delete forever
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {pendingDelete && (
        <Modal open onClose={() => setPendingDelete(null)} size="sm">
          <ModalHeader title="Delete permanently?" onClose={() => setPendingDelete(null)} />
          <ModalBody>
            <Text size="sm">
              <strong>{pendingDelete.name}</strong> will be permanently deleted and cannot be recovered.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)} disabled={isConfirmPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmPermanentDelete} disabled={isConfirmPending}>
              Delete forever
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
